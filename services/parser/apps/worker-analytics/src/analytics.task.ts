import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PoolClient } from 'pg';
import { DbService } from '../../../libs/db/src';
import { HttpService } from '../../../libs/http/src';
import { applyRssUpdatedAt, parseRssItems } from '../../../libs/parsers/src';
import { XmlService } from '../../../libs/xml/src';

interface ReconcileTenderRow {
  object_number: string;
  etap_zakupki: string | null;
}

interface ColumnRow {
  column_name: string;
}

@Injectable()
export class AnalyticsTask {
  private readonly logger = new Logger(AnalyticsTask.name);
  private readonly terminalStatusPatterns = [
    /определ[её]н поставщик/i,
    /заверш[её]н/i,
    /отмен[её]н/i,
    /не состоял/i,
    /несостоявш/i,
    /договор заключ[её]н/i,
  ];
  private warnedLifecycleMissing = false;
  private warnedArchiveMissing = false;

  constructor(
    private readonly db: DbService,
    private readonly http: HttpService,
    private readonly xml: XmlService,
  ) {}

  @Cron(process.env.ANALYTICS_CRON || '*/20 * * * *')
  async handleCron() {
    await this.reconcileStatuses();
  }

  @Cron(process.env.ARCHIVE_CRON || '17 3 * * *')
  async handleArchiveCron() {
    await this.archiveTerminalTenders();
  }

  private async reconcileStatuses() {
    try {
      await this.db.withAdvisoryLock('worker-analytics-reconcile', async (client) => {
        const startedAt = Date.now();
        const hasLifecycle = await this.hasLifecycleColumns(client);
        const hasLastReconciled = await this.hasLastReconciledColumn(client);
        const limit = Number(process.env.RECONCILE_LIMIT || 200);
        const lookbackDays = Number(process.env.RECONCILE_LOOKBACK_DAYS || 180);

        const tenders = await this.selectTendersForReconcile(
          client,
          limit,
          lookbackDays,
          hasLifecycle,
          hasLastReconciled,
        );
        if (!tenders.length) {
          this.logger.log('Reconcile: no tenders to process.');
          return;
        }

        const throttleMs = Number(
          process.env.RECONCILE_ZAKUPKI_THROTTLE_MS || process.env.ZAKUPKI_THROTTLE_MS || 2000,
        );
        let processed = 0;
        for (const tender of tenders) {
          try {
            const rssItem = await this.fetchRssByObjectNumber(tender.object_number, throttleMs);
            if (!rssItem) {
              this.logger.warn(`Reconcile skip ${tender.object_number}: exact RSS item not found`);
              continue;
            }

            const nextStatus =
              this.asText(rssItem['description_kv.Этап размещения']) ||
              this.asText(rssItem['description_kv.Этап закупки']) ||
              tender.etap_zakupki;
            const isTerminal = this.isTerminalStatus(nextStatus);
            const href = this.asText(rssItem.link);
            const objectInfo =
              this.asText(rssItem['description_kv.Наименование объекта закупки']) ||
              this.asText(rssItem['description_kv.Наименование закупки']) ||
              this.asText(rssItem.title);
            const zakon =
              this.asText(rssItem['description_kv.Размещение выполняется по']) ||
              (String(rssItem.law || '').includes('223') ? '223' : '44');
            const rssUpdatedAt = this.asText(rssItem.rss_updated_at);

            if (hasLifecycle) {
              await this.db.query(
                `UPDATE public.tenders_gov
                 SET etap_zakupki = COALESCE($2, etap_zakupki),
                     href = COALESCE($3, href),
                     object_info = COALESCE($4, object_info),
                     zakon = COALESCE($5, zakon),
                     rss_updated_at = COALESCE($6::timestamptz, rss_updated_at),
                     is_terminal = $7,
                     terminal_at = CASE
                       WHEN $7 THEN COALESCE(terminal_at, now())
                       ELSE NULL
                     END${hasLastReconciled ? `,
                     last_reconciled_at = now()` : ''}
                 WHERE object_number = $1;`,
                [tender.object_number, nextStatus, href, objectInfo, zakon, rssUpdatedAt, isTerminal],
                client,
              );
            } else {
              await this.db.query(
                `UPDATE public.tenders_gov
                 SET etap_zakupki = COALESCE($2, etap_zakupki),
                     href = COALESCE($3, href),
                     object_info = COALESCE($4, object_info),
                     zakon = COALESCE($5, zakon),
                     rss_updated_at = COALESCE($6::timestamptz, rss_updated_at)${hasLastReconciled ? `,
                     last_reconciled_at = now()` : ''}
                 WHERE object_number = $1;`,
                [tender.object_number, nextStatus, href, objectInfo, zakon, rssUpdatedAt],
                client,
              );
            }
            processed += 1;
          } catch (err) {
            this.logger.warn(`Reconcile failed for ${tender.object_number}: ${String(err)}`);
          }
        }
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        this.logger.log(`Reconcile: fetched ${processed}/${tenders.length} tenders in ${elapsedSec}s.`);
      });
    } catch (err) {
      this.logger.error(`Reconcile run failed: ${String(err)}`);
    }
  }

  private async archiveTerminalTenders() {
    try {
      await this.db.withAdvisoryLock('worker-analytics-archive', async (client) => {
        const hasLifecycle = await this.hasLifecycleColumns(client);
        const hasArchiveTable = await this.hasArchiveTable(client);
        if (!hasArchiveTable) {
          if (!this.warnedArchiveMissing) {
            this.logger.warn('Archive table public.tenders_gov_archive not found. Skip archive step.');
            this.warnedArchiveMissing = true;
          }
          return;
        }

        const archiveAfterDays = Number(process.env.ARCHIVE_AFTER_DAYS || 30);
        const archiveLimit = Number(process.env.ARCHIVE_LIMIT || 200);
        const candidates = await this.selectTendersForArchive(client, archiveAfterDays, archiveLimit, hasLifecycle);
        if (!candidates.length) {
          this.logger.log('Archive: no terminal tenders to archive.');
          return;
        }

        const objectNumbers = candidates.map((row) => row.object_number);
        await this.db.withTransaction(client, async () => {
          await this.db.query(
            `INSERT INTO public.tenders_gov_archive
             SELECT tg.*
             FROM public.tenders_gov tg
             WHERE tg.object_number = ANY($1::text[])
             ON CONFLICT (object_number) DO UPDATE
             SET archived_at = now(),
                 etap_zakupki = EXCLUDED.etap_zakupki,
                 rss_updated_at = EXCLUDED.rss_updated_at,
                 last_full_parsed_at = EXCLUDED.last_full_parsed_at;`,
            [objectNumbers],
            client,
          );

          await this.db.query(
            `UPDATE public.tenders_gov_archive
             SET archived_at = now()
             WHERE object_number = ANY($1::text[])
               AND archived_at IS NULL;`,
            [objectNumbers],
            client,
          );

          const cleanupEnabled = (process.env.ARCHIVE_CLEANUP_ENABLED || 'true').toLowerCase() === 'true';
          if (cleanupEnabled) {
            await this.db.query(
              `DELETE FROM public.tender_attachments_summary
               WHERE object_number = ANY($1::text[]);`,
              [objectNumbers],
              client,
            );
            await this.db.query(
              `DELETE FROM public.tender_attachments
               WHERE object_number = ANY($1::text[]);`,
              [objectNumbers],
              client,
            );
            await this.db.query(
              `DELETE FROM public.tender_items
               WHERE object_number = ANY($1::text[]);`,
              [objectNumbers],
              client,
            );
          }

          const deleteMainEnabled =
            (process.env.ARCHIVE_DELETE_MAIN_ENABLED || 'true').toLowerCase() === 'true';
          if (deleteMainEnabled) {
            await this.db.query(
              `DELETE FROM public.tenders_gov
               WHERE object_number = ANY($1::text[]);`,
              [objectNumbers],
              client,
            );
          } else if (hasLifecycle) {
            await this.db.query(
              `UPDATE public.tenders_gov
               SET archived_at = now()
               WHERE object_number = ANY($1::text[])
                 AND archived_at IS NULL;`,
              [objectNumbers],
              client,
            );
          }
        });

        this.logger.log(`Archive: processed ${objectNumbers.length} tenders.`);
      });
    } catch (err) {
      this.logger.error(`Archive run failed: ${String(err)}`);
    }
  }

  private async selectTendersForReconcile(
    client: PoolClient,
    limit: number,
    lookbackDays: number,
    hasLifecycle: boolean,
    hasLastReconciled: boolean,
  ): Promise<ReconcileTenderRow[]> {
    const terminalSql = this.terminalSqlExpression();
    const hotLimit = Number(process.env.RECONCILE_HOT_LIMIT || Math.max(1, Math.floor(limit * 0.7)));
    const backlogLimit = Math.max(1, limit - hotLimit);

    if (hasLifecycle) {
      if (hasLastReconciled) {
        const res = await this.db.query<ReconcileTenderRow>(
          `WITH hot AS (
             SELECT object_number, etap_zakupki
             FROM public.tenders_gov
             WHERE COALESCE(is_terminal, false) = false
               AND (last_full_parsed_at IS NOT NULL OR rss_updated_at IS NOT NULL)
               AND COALESCE(last_full_parsed_at, rss_updated_at) >= now() - make_interval(days => $4)
             ORDER BY COALESCE(rss_updated_at, last_full_parsed_at) DESC NULLS LAST
             LIMIT $1
           ),
           backlog AS (
             SELECT object_number, etap_zakupki
             FROM public.tenders_gov
             WHERE COALESCE(is_terminal, false) = false
               AND (last_full_parsed_at IS NOT NULL OR rss_updated_at IS NOT NULL)
               AND COALESCE(last_full_parsed_at, rss_updated_at) >= now() - make_interval(days => $4)
             ORDER BY COALESCE(last_reconciled_at, to_timestamp(0)) ASC,
                      COALESCE(rss_updated_at, last_full_parsed_at) DESC NULLS LAST
             LIMIT $2
           )
           SELECT object_number, etap_zakupki
           FROM (
             SELECT * FROM hot
             UNION
             SELECT * FROM backlog
           ) q
           LIMIT $3;`,
          [hotLimit, backlogLimit, limit, lookbackDays],
          client,
        );
        return res.rows;
      }

      const res = await this.db.query<ReconcileTenderRow>(
        `SELECT object_number, etap_zakupki
         FROM public.tenders_gov
         WHERE COALESCE(is_terminal, false) = false
           AND (last_full_parsed_at IS NOT NULL OR rss_updated_at IS NOT NULL)
           AND COALESCE(last_full_parsed_at, rss_updated_at) >= now() - make_interval(days => $2)
         ORDER BY COALESCE(rss_updated_at, last_full_parsed_at) DESC NULLS LAST
         LIMIT $1;`,
        [limit, lookbackDays],
        client,
      );
      return res.rows;
    }

    if (!this.warnedLifecycleMissing) {
      this.logger.warn('Lifecycle columns not found on public.tenders_gov. Reconcile will use status text only.');
      this.warnedLifecycleMissing = true;
    }

    if (hasLastReconciled) {
      const res = await this.db.query<ReconcileTenderRow>(
        `WITH hot AS (
           SELECT object_number, etap_zakupki
           FROM public.tenders_gov
           WHERE NOT (${terminalSql})
             AND (last_full_parsed_at IS NOT NULL OR rss_updated_at IS NOT NULL)
             AND COALESCE(last_full_parsed_at, rss_updated_at) >= now() - make_interval(days => $4)
           ORDER BY COALESCE(rss_updated_at, last_full_parsed_at) DESC NULLS LAST
           LIMIT $1
         ),
         backlog AS (
           SELECT object_number, etap_zakupki
           FROM public.tenders_gov
           WHERE NOT (${terminalSql})
             AND (last_full_parsed_at IS NOT NULL OR rss_updated_at IS NOT NULL)
             AND COALESCE(last_full_parsed_at, rss_updated_at) >= now() - make_interval(days => $4)
           ORDER BY COALESCE(last_reconciled_at, to_timestamp(0)) ASC,
                    COALESCE(rss_updated_at, last_full_parsed_at) DESC NULLS LAST
           LIMIT $2
         )
         SELECT object_number, etap_zakupki
         FROM (
           SELECT * FROM hot
           UNION
           SELECT * FROM backlog
         ) q
         LIMIT $3;`,
        [hotLimit, backlogLimit, limit, lookbackDays],
        client,
      );
      return res.rows;
    }

    const res = await this.db.query<ReconcileTenderRow>(
      `SELECT object_number, etap_zakupki
       FROM public.tenders_gov
       WHERE NOT (${terminalSql})
         AND (last_full_parsed_at IS NOT NULL OR rss_updated_at IS NOT NULL)
         AND COALESCE(last_full_parsed_at, rss_updated_at) >= now() - make_interval(days => $2)
       ORDER BY COALESCE(rss_updated_at, last_full_parsed_at) DESC NULLS LAST
       LIMIT $1;`,
      [limit, lookbackDays],
      client,
    );
    return res.rows;
  }

  private async selectTendersForArchive(
    client: PoolClient,
    archiveAfterDays: number,
    limit: number,
    hasLifecycle: boolean,
  ): Promise<ReconcileTenderRow[]> {
    const terminalSql = this.terminalSqlExpression();
    const agedSql = this.archiveAgeSqlExpression();
    const agedFallbackSql = this.archiveAgeFallbackSqlExpression();
    const terminalWithFallbackSql = `(COALESCE(is_terminal, false) = true OR (${terminalSql}))`;
    const terminalImmediate = (process.env.ARCHIVE_TERMINAL_IMMEDIATE || 'true').toLowerCase() === 'true';

    if (hasLifecycle) {
      const whereSql = terminalImmediate
        ? `(${terminalWithFallbackSql}) OR (${agedSql})`
        : `(${terminalWithFallbackSql}) AND (${agedSql})`;
      const res = await this.db.query<ReconcileTenderRow>(
        `SELECT object_number, etap_zakupki
         FROM public.tenders_gov
         WHERE archived_at IS NULL
           AND (${whereSql})
         ORDER BY COALESCE(terminal_at, enddt, rss_updated_at, last_full_parsed_at, updated_at, created_at) ASC NULLS LAST
         LIMIT $2;`,
        [archiveAfterDays, limit],
        client,
      );
      return res.rows;
    }

    const fallbackTerminalWithSql = `(${terminalSql})`;
    const fallbackWhereSql = terminalImmediate
      ? `(${fallbackTerminalWithSql}) OR (${agedFallbackSql})`
      : `(${fallbackTerminalWithSql}) AND (${agedFallbackSql})`;
    const res = await this.db.query<ReconcileTenderRow>(
      `SELECT object_number, etap_zakupki
       FROM public.tenders_gov
       WHERE (${fallbackWhereSql})
       ORDER BY COALESCE(enddt, rss_updated_at, last_full_parsed_at, updated_at, created_at) ASC NULLS LAST
       LIMIT $2;`,
      [archiveAfterDays, limit],
      client,
    );
    return res.rows;
  }

  private async fetchRssByObjectNumber(objectNumber: string, throttleMs: number): Promise<Record<string, any> | null> {
    const retries = Number(process.env.RECONCILE_HTTP_RETRIES || 2);
    const retryDelayMs = Number(process.env.RECONCILE_HTTP_RETRY_DELAY_MS || 1000);
    const timeoutMs = Number(process.env.RECONCILE_HTTP_TIMEOUT_MS || 60000);
    const url = this.buildRssUrl(objectNumber);
    const rssText = await this.http.getText(url, {
      timeoutMs,
      retries,
      retryDelayMs,
      throttleKey: 'zakupki.gov.ru',
      minDelayMs: throttleMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru,en;q=0.8',
        Connection: 'keep-alive',
      },
    });

    const rssJson = this.xml.parse(rssText);
    const items = parseRssItems(rssJson).map((item) => applyRssUpdatedAt(item));
    const exact = items.find((item) => this.asText(item.regNumber) === objectNumber);
    return exact || null;
  }

  private buildRssUrl(searchString: string): string {
    const params = new URLSearchParams();
    params.set('searchString', searchString);
    params.set('morphology', 'on');
    params.set('sortDirection', 'false');
    params.set('recordsPerPage', process.env.RECONCILE_RECORDS_PER_PAGE || '_50');
    params.set('showLotsInfoHidden', 'false');
    params.set('sortBy', 'UPDATE_DATE');
    params.set('fz44', 'on');
    params.set('fz223', 'on');
    return `https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?${params.toString()}`;
  }

  private async hasLifecycleColumns(client: PoolClient): Promise<boolean> {
    const res = await this.db.query<ColumnRow>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'tenders_gov'
         AND column_name IN ('is_terminal', 'terminal_at', 'archived_at');`,
      [],
      client,
    );
    const present = new Set(res.rows.map((row) => row.column_name));
    return (
      present.has('is_terminal') &&
      present.has('terminal_at') &&
      present.has('archived_at')
    );
  }

  private async hasArchiveTable(client: PoolClient): Promise<boolean> {
    const res = await this.db.query<{ exists: string | null }>(
      `SELECT to_regclass('public.tenders_gov_archive') AS exists;`,
      [],
      client,
    );
    return Boolean(res.rows[0]?.exists);
  }

  private async hasLastReconciledColumn(client: PoolClient): Promise<boolean> {
    const res = await this.db.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'tenders_gov'
           AND column_name = 'last_reconciled_at'
       ) AS exists;`,
      [],
      client,
    );
    return Boolean(res.rows[0]?.exists);
  }

  private async touchLastReconciledAt(
    client: PoolClient,
    objectNumber: string,
    hasLastReconciled: boolean,
  ): Promise<void> {
    if (!hasLastReconciled) return;
    await this.db.query(
      `UPDATE public.tenders_gov
       SET last_reconciled_at = now()
       WHERE object_number = $1;`,
      [objectNumber],
      client,
    );
  }

  private terminalSqlExpression(): string {
    return `lower(coalesce(etap_zakupki, '')) ~ '(определ[её]н поставщик|заверш[её]н|отмен[её]н|не состоял|несостоявш|договор заключ[её]н)'`;
  }

  private archiveAgeSqlExpression(): string {
    return `COALESCE(terminal_at, enddt, rss_updated_at, last_full_parsed_at, updated_at, created_at) <= now() - make_interval(days => $1)`;
  }

  private archiveAgeFallbackSqlExpression(): string {
    return `COALESCE(enddt, rss_updated_at, last_full_parsed_at, updated_at, created_at) <= now() - make_interval(days => $1)`;
  }

  private isTerminalStatus(value: string | null | undefined): boolean {
    const status = String(value || '').trim();
    if (!status) return false;
    return this.terminalStatusPatterns.some((pattern) => pattern.test(status));
  }

  private asText(value: any): string | null {
    if (value === undefined || value === null) return null;
    const str = String(value).trim();
    return str ? str : null;
  }
}
