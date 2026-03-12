import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '../../../libs/db/src';
import { HttpService } from '../../../libs/http/src';
import { XmlService } from '../../../libs/xml/src';
import {
  applyRssUpdatedAt,
  extract223Attachments,
  extract223Items,
  extract223XmlFromHtml,
  extract44Attachments,
  extract44Items,
  find223PrintFormUrl,
  normalize223,
  normalize44,
  parseRssItems,
} from '../../../libs/parsers/src';
import { PoolClient } from 'pg';

interface TenderRow {
  object_number: string;
  zakon: string | null;
  href: string | null;
  rss_updated_at: string | null;
  url_223_xml: string | null;
}

@Injectable()
export class IngestTask {
  private readonly logger = new Logger(IngestTask.name);
  private running = false;
  private hasArchiveTableCache: boolean | null = null;

  constructor(
    private readonly db: DbService,
    private readonly http: HttpService,
    private readonly xml: XmlService,
  ) {}

  @Cron(process.env.INGEST_CRON || '*/5 * * * *')
  async handleCron() {
    await this.run();
  }

  async run() {
    if (this.running) return;
    this.running = true;

    try {
      await this.db.withAdvisoryLock('worker-ingest', async (client) => {
        await this.runWithClient(client);
      });
    } catch (err) {
      this.logger.error(`Run failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }

  private async runWithClient(client: PoolClient) {
    await this.ingestRss(client);
    const limit = Number(process.env.INGEST_LIMIT || 50);
    const tenders = await this.selectTendersForParsing(client, limit);

    for (const tender of tenders) {
      const zakon = String(tender.zakon || '').toLowerCase();
      try {
        if (zakon.includes('223')) {
          await this.process223Tender(client, tender);
        } else {
          await this.process44Tender(client, tender);
        }
      } catch (err) {
        this.logger.error(`Tender ${tender.object_number} failed: ${String(err)}`);
      }
    }
  }

  private async ingestRss(client: PoolClient) {
    const lookbackDays = Number(process.env.INGEST_LOOKBACK_DAYS || 30);
    const pagesPerRun = Number(process.env.INGEST_PAGES || 1);
    const recordsPerPage = process.env.INGEST_RECORDS_PER_PAGE || '_200';
    const throttleMs = Number(process.env.ZAKUPKI_THROTTLE_MS || 2000);

    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - lookbackDays);

    const formatDDMMYYYY = (d: Date) => {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}.${mm}.${yyyy}`;
    };

    const publishDateFrom = formatDDMMYYYY(startDate);
    const publishDateTo = formatDDMMYYYY(today);

    const baseParams: Record<string, string> = {
      morphology: 'on',
      sortDirection: 'false',
      recordsPerPage,
      showLotsInfoHidden: 'false',
      sortBy: 'UPDATE_DATE',
      publishDateFrom,
      publishDateTo,
    };

    const stages = { af: 'on' };
    const laws = { fz44: 'on', fz223: 'on' };

    for (let page = 1; page <= pagesPerRun; page += 1) {
      const query = {
        ...baseParams,
        ...stages,
        ...laws,
        pageNumber: String(page),
      };

      const url = `https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?${this.toQuery(query)}`;

      let rssText: string;
      try {
        rssText = await this.http.getText(url, {
          timeoutMs: 60000,
          throttleKey: 'zakupki.gov.ru',
          minDelayMs: throttleMs,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ru,en;q=0.8',
            Connection: 'keep-alive',
          },
        });
      } catch (err) {
        this.logger.warn(`RSS fetch failed for page=${page}: ${String(err)}`);
        continue;
      }

      const rssJson = this.xml.parse(rssText);
      const items = parseRssItems(rssJson).map((item) => applyRssUpdatedAt(item));
      const objectNumbers = Array.from(
        new Set(
          items
            .map((item) => String(item.regNumber || '').trim())
            .filter((value) => value.length > 0),
        ),
      );
      const archivedObjectNumbers = await this.selectArchivedObjectNumbers(client, objectNumbers);
      let skippedArchived = 0;

      for (const item of items) {
        const objectNumber = String(item.regNumber || '').trim();
        if (!objectNumber) continue;
        if (archivedObjectNumbers.has(objectNumber)) {
          skippedArchived += 1;
          continue;
        }

        const zakonRaw = item['description_kv.Размещение выполняется по'];
        const zakonFallback = item.law === '223' ? '223' : '44';
        const zakon = zakonRaw || zakonFallback;

        const objectInfo =
          item['description_kv.Наименование объекта закупки'] ||
          item['description_kv.Наименование закупки'] ||
          item.title ||
          null;

        const data = {
          object_number: objectNumber,
          href: item.link || null,
          zakon,
          object_info: objectInfo,
          kotirovki: item.title || null,
          etap_zakupki: item['description_kv.Этап размещения'] || null,
          rss_updated_at: item.rss_updated_at || null,
        };

        await this.upsertTenderRss(client, data);
        await this.markNeedsRefresh(client, objectNumber);
      }

      if (skippedArchived > 0) {
        this.logger.log(`RSS skip archived: page=${page}, skipped=${skippedArchived}`);
      }
    }
  }

  private async process44Tender(client: PoolClient, tender: TenderRow) {
    const throttleMs = Number(process.env.ZAKUPKI_THROTTLE_MS || 2000);
    const url = `https://zakupki.gov.ru/epz/order/notice/printForm/viewXml.html?regNumber=${tender.object_number}`;

    const xmlText = await this.http.getText(url, {
      throttleKey: 'zakupki.gov.ru',
      minDelayMs: throttleMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru,en;q=0.8',
        Connection: 'keep-alive',
      },
    });

    const parsed = this.xml.parse(xmlText);
    const normalized = normalize44(parsed);

    if (normalized._error) {
      throw new Error(String(normalized._error));
    }

    await this.db.withTransaction(client, async () => {
      if (await this.isObjectArchived(client, tender.object_number)) {
        this.logger.log(`Skip full parse for archived tender ${tender.object_number}`);
        return;
      }

      const mapped = this.map44TenderFields(normalized);
      if (!mapped.object_number) mapped.object_number = tender.object_number;
      await this.upsertTenderFull(client, mapped);

      await this.deleteTenderItems(client, tender.object_number);
      await this.deleteTenderAttachments(client, tender.object_number);

      const items = extract44Items([parsed]);
      const attachments = extract44Attachments([parsed]);

      await this.insertTenderItems(client, items);
      await this.updateIndustryOkpd2(client, tender.object_number, items);
      await this.insertTenderAttachments(client, attachments);

      await this.markParsed(client, tender.object_number);
    });
  }

  private async process223Tender(client: PoolClient, tender: TenderRow) {
    const throttleMs = Number(process.env.ZAKUPKI_THROTTLE_MS || 2000);
    let url223 = tender.url_223_xml;

    if (!url223) {
      const infoUrl = `https://zakupki.gov.ru/epz/order/notice/notice223/common-info.html?regNumber=${tender.object_number}`;
      const html = await this.http.getText(infoUrl, {
        throttleKey: 'zakupki.gov.ru',
        minDelayMs: throttleMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          Accept: 'text/html',
          'Accept-Language': 'ru,en;q=0.8',
          Connection: 'keep-alive',
        },
      });

      const { url } = find223PrintFormUrl(html);
      if (url) {
        url223 = url;
        await this.update223Url(client, tender.object_number, url223);
      }
    }

    if (!url223) {
      this.logger.warn(`223 tender ${tender.object_number}: url_223_xml not found`);
      return;
    }

    const html = await this.http.getText(url223, {
      throttleKey: 'zakupki.gov.ru',
      minDelayMs: throttleMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru,en;q=0.8',
        Connection: 'keep-alive',
      },
    });

    const xmlText = extract223XmlFromHtml(html);
    const parsed = this.xml.parse(xmlText);
    const normalized = normalize223(parsed);

    if (normalized._error) {
      throw new Error(String(normalized._error));
    }

    await this.db.withTransaction(client, async () => {
      if (await this.isObjectArchived(client, tender.object_number)) {
        this.logger.log(`Skip full parse for archived tender ${tender.object_number}`);
        return;
      }

      const mapped = this.map223TenderFields(normalized);
      if (!mapped.object_number) mapped.object_number = tender.object_number;
      await this.upsertTenderFull(client, mapped);

      await this.deleteTenderItems(client, tender.object_number);
      await this.deleteTenderAttachments(client, tender.object_number);

      const items = extract223Items([normalized]);
      const attachments = extract223Attachments([normalized]);

      await this.insertTenderItems(client, items);
      await this.updateIndustryOkpd2(client, tender.object_number, items);
      await this.insertTenderAttachments(client, attachments);

      await this.markParsed(client, tender.object_number);
    });
  }

  private toQuery(obj: Record<string, string>) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        for (const x of v) {
          parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(x))}`);
        }
      } else if (v !== undefined && v !== null) {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
    }
    return parts.join('&');
  }

  private async upsertTenderRss(client: PoolClient, data: Record<string, any>) {
    await this.upsert(client, 'public.tenders_gov', data, ['object_number']);
  }

  private async upsertTenderFull(client: PoolClient, data: Record<string, any>) {
    await this.upsert(client, 'public.tenders_gov', data, ['object_number']);
  }

  private async markNeedsRefresh(client: PoolClient, objectNumber: string) {
    await this.db.query(
      `UPDATE public.tenders_gov
       SET needs_refresh = true
       WHERE object_number = $1
         AND archived_at IS NULL
         AND (
           last_full_parsed_at IS NULL
           OR (rss_updated_at IS NOT NULL AND rss_updated_at > last_full_parsed_at)
         );`,
      [objectNumber],
      client,
    );
  }

  private async selectTendersForParsing(client: PoolClient, limit: number): Promise<TenderRow[]> {
    const res = await this.db.query<TenderRow>(
      `SELECT object_number, zakon, href, rss_updated_at, url_223_xml
       FROM public.tenders_gov
       WHERE needs_refresh = true
         AND archived_at IS NULL
       ORDER BY rss_updated_at DESC NULLS LAST
       LIMIT $1;`,
      [limit],
      client,
    );

    return res.rows;
  }

  private async selectArchivedObjectNumbers(client: PoolClient, objectNumbers: string[]): Promise<Set<string>> {
    const unique = Array.from(new Set(objectNumbers.map((value) => value.trim()).filter(Boolean)));
    if (!unique.length) return new Set();

    const archived = new Set<string>();

    const inMain = await this.db.query<{ object_number: string }>(
      `SELECT object_number
       FROM public.tenders_gov
       WHERE object_number = ANY($1::text[])
         AND archived_at IS NOT NULL;`,
      [unique],
      client,
    );
    for (const row of inMain.rows) {
      if (row.object_number) archived.add(String(row.object_number));
    }

    if (await this.hasArchiveTable(client)) {
      const inArchive = await this.db.query<{ object_number: string }>(
        `SELECT object_number
         FROM public.tenders_gov_archive
         WHERE object_number = ANY($1::text[]);`,
        [unique],
        client,
      );
      for (const row of inArchive.rows) {
        if (row.object_number) archived.add(String(row.object_number));
      }
    }

    return archived;
  }

  private async hasArchiveTable(client: PoolClient): Promise<boolean> {
    if (this.hasArchiveTableCache !== null) return this.hasArchiveTableCache;
    const res = await this.db.query<{ exists: string | null }>(
      `SELECT to_regclass('public.tenders_gov_archive') AS exists;`,
      [],
      client,
    );
    this.hasArchiveTableCache = Boolean(res.rows[0]?.exists);
    return this.hasArchiveTableCache;
  }

  private async isObjectArchived(client: PoolClient, objectNumber: string): Promise<boolean> {
    if (!objectNumber) return false;
    const archived = await this.selectArchivedObjectNumbers(client, [objectNumber]);
    return archived.has(objectNumber);
  }

  private async update223Url(client: PoolClient, objectNumber: string, url: string) {
    await this.db.query(
      `UPDATE public.tenders_gov
       SET url_223_xml = $1
       WHERE object_number = $2;`,
      [url, objectNumber],
      client,
    );
  }

  private async deleteTenderItems(client: PoolClient, objectNumber: string) {
    await this.db.query(
      'DELETE FROM public.tender_items WHERE object_number = $1;',
      [objectNumber],
      client,
    );
  }

  private async deleteTenderAttachments(client: PoolClient, objectNumber: string) {
    await this.db.query(
      'DELETE FROM public.tender_attachments WHERE object_number = $1;',
      [objectNumber],
      client,
    );
  }

  private async insertTenderItems(client: PoolClient, items: any[]) {
    if (!items.length) return;

    const columns = [
      'is_for_small_or_middle',
      'is_ignored',
      'is_centralized',
      'is_joint_lot',
      'is_prohibition_foreign',
      'is_impossibility_prohibition',
      'object_number',
      'item_name',
      'okpdname',
      'okpdcode',
      'quantity_name',
      'price_for_one',
      'quantity_value',
      'total_sum',
      'lot_item_number',
      'characteristics_detailed_json',
      'restriction_reasons_json',
      'okei_code',
      'okei_name',
      'impossibility_reason',
    ];

    const rows = items.map((item) => ({
      is_for_small_or_middle: false,
      is_ignored: false,
      is_centralized: false,
      is_joint_lot: false,
      is_prohibition_foreign: item.is_prohibition_foreign ?? null,
      is_impossibility_prohibition: item.is_impossibility_prohibition ?? null,
      object_number: item.object_number ?? null,
      item_name: item.item_name ?? null,
      okpdname: item.okpd2_name ?? null,
      okpdcode: item.okpd2_code ?? null,
      quantity_name: item.okei_name ?? null,
      price_for_one: this.toNumber(item.price_for_one),
      quantity_value: this.toNumber(item.quantity_value),
      total_sum: this.toNumber(item.total_sum),
      lot_item_number: 0,
      characteristics_detailed_json: item.characteristics_detailed_json ?? null,
      restriction_reasons_json: item.restriction_reasons_json ?? null,
      okei_code: item.okei_code ?? null,
      okei_name: item.okei_name ?? null,
      impossibility_reason: item.impossibility_reason ?? null,
    }));

    await this.bulkInsert(client, 'public.tender_items', columns, rows);
  }

  private async insertTenderAttachments(client: PoolClient, attachments: any[]) {
    if (!attachments.length) return;

    const columns = [
      'object_number',
      'published_content_id',
      'file_name',
      'doc_kind_code',
      'doc_kind_name',
      'file_size',
      'doc_date',
      'url',
    ];

    const rows = attachments.map((item) => ({
      object_number: item.object_number ?? null,
      published_content_id: item.published_content_id ?? null,
      file_name: item.file_name ?? null,
      doc_kind_code: item.doc_kind_code ?? null,
      doc_kind_name: item.doc_kind_name ?? null,
      file_size: this.toNumber(item.file_size),
      doc_date: item.doc_date ?? null,
      url: item.url ?? null,
    }));

    await this.bulkInsert(client, 'public.tender_attachments', columns, rows);
  }

  private async updateIndustryOkpd2(client: PoolClient, objectNumber: string, items: any[]) {
    const first = items.find((item) => {
      const code = (item?.okpd2_code ?? '').toString().trim();
      const name = (item?.okpd2_name ?? '').toString().trim();
      return Boolean(code || name);
    });
    if (!first) return;

    const okpd2Code = (first?.okpd2_code ?? '').toString().trim() || null;
    const okpd2Name = (first?.okpd2_name ?? '').toString().trim() || null;
    const okpd2ForIndustry = okpd2Code || okpd2Name;
    const okpd2ForDisplay =
      okpd2Code && okpd2Name
        ? `${okpd2Code} - ${okpd2Name}`
        : okpd2ForIndustry;

    if (!okpd2ForIndustry && !okpd2ForDisplay) return;

    await this.db.query(
      `UPDATE public.tenders_gov
       SET industry_okpd2 = COALESCE($1, industry_okpd2),
           okpd2info = COALESCE($2, okpd2info)
       WHERE object_number = $3;`,
      [okpd2ForIndustry, okpd2ForDisplay, objectNumber],
      client,
    );
  }

  private async markParsed(client: PoolClient, objectNumber: string) {
    await this.db.query(
      `UPDATE public.tenders_gov
       SET last_full_parsed_at = now(),
           needs_refresh = false
       WHERE object_number = $1;`,
      [objectNumber],
      client,
    );
  }

  private async upsert(
    client: PoolClient,
    table: string,
    data: Record<string, any>,
    conflictColumns: string[],
  ) {
    const columns = Object.keys(data);
    if (!columns.length) return;

    const values = columns.map((col) => data[col] ?? null);
    const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
    const updates = columns
      .filter((c) => !conflictColumns.includes(c))
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ');

    const query = `INSERT INTO ${table} (${columns.join(', ')})
      VALUES (${placeholders})
      ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updates};`;

    await this.db.query(query, values, client);
  }

  private async bulkInsert(
    client: PoolClient,
    table: string,
    columns: string[],
    rows: Record<string, any>[],
  ) {
    const batchSize = Number(process.env.INGEST_INSERT_BATCH || 200);
    for (let i = 0; i < rows.length; i += batchSize) {
      const slice = rows.slice(i, i + batchSize);
      const values: any[] = [];
      const placeholders: string[] = [];

      slice.forEach((row, rowIndex) => {
        const baseIndex = rowIndex * columns.length;
        const rowPlaceholders = columns.map((_, colIndex) => `$${baseIndex + colIndex + 1}`);
        placeholders.push(`(${rowPlaceholders.join(', ')})`);
        for (const col of columns) {
          values.push(row[col] ?? null);
        }
      });

      const query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')};`;
      await this.db.query(query, values, client);
    }
  }

  private map44TenderFields(json: any): Record<string, any> {
    const root = json._root || {};
    const get = (obj: any, path: (string | number)[]) =>
      path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    const pick = (...paths: (string | number)[][]) => {
      for (const p of paths) {
        const value = get(root, p);
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          return value;
        }
      }
      return null;
    };

    const endDateRaw = get(root, [
      'notificationInfo',
      'customerRequirementsInfo',
      'customerRequirementInfo',
      'contractConditionsInfo',
      'contractExecutionPaymentPlan',
      'contractExecutionTermsInfo',
      'ns3:notRelativeTermsInfo',
      'ns3:endDate',
    ]);

    const contract_enddate = endDateRaw
      ? String(endDateRaw).replace(/\+\d{2}:\d{2}$/, '') + 'T00:00:00+03:00'
      : null;
    const kvrInfo = get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'IKZInfo', 'KVRInfo', 'ns3:KVR', 'ns2:name']) ?? null;
    const objectInfo = pick(
      ['commonInfo', 'purchaseObjectInfo'],
      ['notificationInfo', 'purchaseObjectsInfo', 'ns3:purchaseObject', 'ns3:name'],
      ['notificationInfo', 'purchaseObjectsInfo', 'notDrugPurchaseObjectsInfo', 'ns3:purchaseObject', 'ns3:name'],
      ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'IKZInfo', 'purchaseObjectInfo'],
      ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'IKZInfo', 'KVRInfo', 'ns3:KVR', 'ns2:name'],
    );

    return {
      object_number: get(root, ['commonInfo', 'purchaseNumber']) ?? null,
      id: get(root, ['id']) ?? null,
      href: get(root, ['commonInfo', 'href']) ?? null,
      object_info: objectInfo,
      placingway_code: get(root, ['commonInfo', 'placingWay', 'ns2:code']) ?? null,
      placingway_name: get(root, ['commonInfo', 'placingWay', 'ns2:name']) ?? null,
      etp_code: get(root, ['commonInfo', 'ETP', 'ns2:code']) ?? null,
      etp_name: get(root, ['commonInfo', 'ETP', 'ns2:name']) ?? null,
      etp_url: get(root, ['commonInfo', 'ETP', 'ns2:url']) ?? null,
      onst83ch2: get(root, ['commonInfo', 'contractConclusionOnSt83Ch2']) ?? null,
      startdt: pick(
        ['notificationInfo', 'procedureInfo', 'collectingInfo', 'startDT'],
        ['notificationInfo', 'procedureInfo', 'collectingInfo', 'startDateTime'],
        ['notificationInfo', 'procedureInfo', 'collectingInfo', 'startDate'],
      ),
      enddt: pick(
        ['notificationInfo', 'procedureInfo', 'collectingInfo', 'endDT'],
        ['notificationInfo', 'procedureInfo', 'collectingInfo', 'endDateTime'],
        ['notificationInfo', 'procedureInfo', 'collectingInfo', 'endDate'],
      ),
      maxprice: this.toNumber(get(root, ['notificationInfo', 'contractConditionsInfo', 'maxPriceInfo', 'maxPrice'])),
      currency_code: get(root, ['notificationInfo', 'contractConditionsInfo', 'maxPriceInfo', 'currency', 'ns2:code']) ?? null,
      currency_name: get(root, ['notificationInfo', 'contractConditionsInfo', 'maxPriceInfo', 'currency', 'ns2:name']) ?? null,
      bik: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractGuarantee', 'account', 'ns3:bik']) ?? null,
      settlementaccount: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractGuarantee', 'account', 'ns3:settlementAccount']) ?? null,
      personalaccount: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractGuarantee', 'account', 'ns3:personalAccount']) ?? null,
      creditorgname: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractGuarantee', 'account', 'ns3:creditOrgName']) ?? null,
      corraccountnumber: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractGuarantee', 'account', 'ns3:corrAccountNumber']) ?? null,
      procedureinfo: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractGuarantee', 'procedureInfo']) ?? null,
      part: this.toNumber(get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractGuarantee', 'part'])),
      ikz_code: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'IKZInfo', 'purchaseCode']) ?? null,
      ikz_customercode: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'IKZInfo', 'customerCode']) ?? null,
      ikz_number: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'IKZInfo', 'purchaseNumber']) ?? null,
      ikz_ordernumber: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'IKZInfo', 'purchaseOrderNumber']) ?? null,
      okpd2info: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'IKZInfo', 'OKPD2Info', 'ns3:OKPD2', 'ns2:OKPDName']) ?? null,
      kvr_code: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'IKZInfo', 'KVRInfo', 'ns3:KVR', 'ns2:code']) ?? null,
      kvr_info: kvrInfo,
      finance_total: this.toNumber(get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'contractExecutionPaymentPlan', 'financingSourcesInfo', 'financeInfo', 'total'])),
      countrycode: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'deliveryPlacesInfo', 'byGARInfo', 'ns3:countryInfo', 'ns2:countryCode']) ?? null,
      countryfullname: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'deliveryPlacesInfo', 'byGARInfo', 'ns3:countryInfo', 'ns2:countryFullName']) ?? null,
      garaddress: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'deliveryPlacesInfo', 'byGARInfo', 'ns3:GARInfo', 'ns3:GARAddress']) ?? null,
      onesiderejectionst95: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'isOneSideRejectionSt95']) ?? null,
      regnum: get(root, ['purchaseResponsibleInfo', 'responsibleOrgInfo', 'regNum']) ?? null,
      consregistrynum: get(root, ['purchaseResponsibleInfo', 'responsibleOrgInfo', 'consRegistryNum']) ?? null,
      fullname: get(root, ['purchaseResponsibleInfo', 'responsibleOrgInfo', 'fullName']) ?? null,
      postaddress: get(root, ['purchaseResponsibleInfo', 'responsibleOrgInfo', 'postAddress']) ?? null,
      factaddress: get(root, ['purchaseResponsibleInfo', 'responsibleOrgInfo', 'factAddress']) ?? null,
      inn: get(root, ['purchaseResponsibleInfo', 'responsibleOrgInfo', 'INN']) ?? null,
      kpp: get(root, ['purchaseResponsibleInfo', 'responsibleOrgInfo', 'KPP']) ?? null,
      responsiblerole: get(root, ['purchaseResponsibleInfo', 'responsibleRole']) ?? null,
      orgpostaddress: get(root, ['purchaseResponsibleInfo', 'responsibleInfo', 'orgPostAddress']) ?? null,
      orgfactaddress: get(root, ['purchaseResponsibleInfo', 'responsibleInfo', 'orgFactAddress']) ?? null,
      person_lastname: get(root, ['purchaseResponsibleInfo', 'responsibleInfo', 'contactPersonInfo', 'ns3:lastName']) ?? null,
      person_firstname: get(root, ['purchaseResponsibleInfo', 'responsibleInfo', 'contactPersonInfo', 'ns3:firstName']) ?? null,
      person_middlename: get(root, ['purchaseResponsibleInfo', 'responsibleInfo', 'contactPersonInfo', 'ns3:middleName']) ?? null,
      contactemail: get(root, ['purchaseResponsibleInfo', 'responsibleInfo', 'contactEMail']) ?? null,
      contactphone: get(root, ['purchaseResponsibleInfo', 'responsibleInfo', 'contactPhone']) ?? null,
      contactfax: get(root, ['purchaseResponsibleInfo', 'responsibleInfo', 'contactFax']) ?? null,
      purchase_procedure_type: json['ns7:epNotificationEF2020']?.commonInfo?.placingWay?.['ns2:name'] ?? null,
      position_number: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'tenderPlan2020Info', 'ns3:position2020Number']) ?? null,
      biddingdt: json['ns7:epNotificationEF2020']?.notificationInfo?.procedureInfo?.biddingDate ?? null,
      summarizingdt: json['ns7:epNotificationEF2020']?.notificationInfo?.procedureInfo?.summarizingDate ?? null,
      publicdiscussion: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'mustPublicDiscussion']) ?? null,
      contract_enddate,
      deliveryplace: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'deliveryPlacesInfo', 'byGARInfo', 'ns3:deliveryPlace']) ?? null,
      shortname: get(root, ['purchaseResponsibleInfo', 'responsibleOrgInfo', 'shortName']) ?? null,
      created_at: get(root, ['commonInfo', 'publishDTInEIS']) ?? null,
      plan_registration_number: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'tenderPlan2020Info', 'ns3:plan2020Number']) ?? null,
      plan_guid: get(root, ['notificationInfo', 'customerRequirementsInfo', 'customerRequirementInfo', 'contractConditionsInfo', 'tenderPlan2020Info', 'ns3:plan2020Number']) ?? null,
    };
  }

  private map223TenderFields(json: any): Record<string, any> {
    const root = json._root || {};
    const get = (obj: any, path: (string | number)[]) =>
      path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    const pick = (...paths: (string | number)[][]) => {
      for (const p of paths) {
        const value = get(root, p);
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          return value;
        }
      }
      return null;
    };
    const unifiedData = get(root, ['ns2:body', 'ns2:item', '_unifiedData']) || {};
    const lotsRaw =
      unifiedData?.['ns2:lots']?.lot ||
      unifiedData?.['ns2:lots']?.['ns2:lot'] ||
      unifiedData?.lots?.lot ||
      null;
    const firstLot = Array.isArray(lotsRaw) ? lotsRaw[0] : lotsRaw;
    const firstLotData = firstLot?.lotData || firstLot?.['ns2:lotData'] || firstLot || {};
    const firstLotItemsRaw =
      firstLotData?.lotItems?.lotItem ||
      firstLotData?.['ns2:lotItems']?.['ns2:lotItem'] ||
      null;
    const firstLotItem = Array.isArray(firstLotItemsRaw) ? firstLotItemsRaw[0] : firstLotItemsRaw;

    const lotSubject =
      firstLotData?.subject ??
      firstLotData?.['ns2:subject'] ??
      get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotData', 'subject']) ??
      null;
    const objectInfo = pick(
      ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:name'],
      ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:purchaseObjectInfo'],
      ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:purchaseCodeName'],
    ) ?? lotSubject;

    return {
      object_number: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:registrationNumber']) ?? null,
      object_info: objectInfo,
      placingway_code: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:purchaseMethodCode']) ?? null,
      placingway_name: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:purchaseCodeName']) ?? null,
      etp_name: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:electronicPlaceInfo', 'name']) ?? null,
      etp_url: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:urlVSRZ']) ?? null,
      startdt: pick(
        ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:documentationDelivery', 'deliveryStartDateTime'],
        ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:documentationDelivery', 'startDateTime'],
        ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:documentationDelivery', 'startDate'],
        ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:applSubmisionStartDate'],
        ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:publicationDateTime'],
      ),
      enddt: pick(
        ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:documentationDelivery', 'deliveryEndDateTime'],
        ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:documentationDelivery', 'endDateTime'],
        ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:documentationDelivery', 'endDate'],
        ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:submissionCloseDateTime'],
        ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:placingProcedure', 'ns2:summingupDateTime'],
      ),
      maxprice: this.toNumber(
        firstLotData?.initialSum ??
        firstLotData?.['ns2:initialSum'] ??
        get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotData', 'initialSum']),
      ),
      currency_code:
        firstLotData?.currency?.code ??
        firstLotData?.['ns2:currency']?.['ns2:code'] ??
        get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotData', 'currency', 'code']) ??
        null,
      currency_name:
        firstLotData?.currency?.name ??
        firstLotData?.['ns2:currency']?.['ns2:name'] ??
        get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotData', 'currency', 'name']) ??
        null,
      procedureinfo: null,
      part: null,
      okpd2info:
        firstLotItem?.okpd2?.name ??
        firstLotItem?.okpd2?.code ??
        firstLotItem?.['ns2:okpd2']?.['ns2:name'] ??
        firstLotItem?.['ns2:okpd2']?.['ns2:code'] ??
        get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotData', 'lotItems', 'lotItem', 'okpd2', 'name']) ??
        null,
      kvr_info: lotSubject,
      finance_total: this.toNumber(
        firstLotData?.initialSum ??
        firstLotData?.['ns2:initialSum'] ??
        get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotData', 'initialSum']),
      ),
      countrycode: null,
      countryfullname: null,
      garaddress: null,
      deliveryplace:
        firstLotData?.deliveryPlace?.address ??
        firstLotData?.deliveryPlace?.name ??
        firstLotData?.['ns2:deliveryPlace']?.['ns2:address'] ??
        firstLotData?.['ns2:deliveryPlace']?.['ns2:name'] ??
        get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotData', 'deliveryPlace', 'address']) ??
        null,
      fullname: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:placer', 'mainInfo', 'fullName']) ?? null,
      postaddress: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:placer', 'mainInfo', 'postalAddress']) ?? null,
      factaddress: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:placer', 'mainInfo', 'legalAddress']) ?? null,
      inn: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:placer', 'mainInfo', 'inn']) ?? null,
      kpp: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:placer', 'mainInfo', 'kpp']) ?? null,
      orgpostaddress: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:placer', 'mainInfo', 'postalAddress']) ?? null,
      orgfactaddress: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:placer', 'mainInfo', 'legalAddress']) ?? null,
      person_lastname: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:contact', 'lastName']) ?? null,
      person_firstname: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:contact', 'firstName']) ?? null,
      person_middlename: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:contact', 'middleName']) ?? null,
      contactemail: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:contact', 'email']) ?? null,
      contactphone: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:contact', 'phone']) ?? null,
      contactfax: null,
      href: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:urlEIS']) ?? null,
      shortname: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:customer', 'mainInfo', 'shortName']) ?? null,
      is_small_or_middle: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotData', 'forSmallOrMiddle']) ?? null,
      is_centralized: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotData', 'centralized']) ?? null,
      is_subcontractors_req: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotData', 'subcontractorsRequirement']) ?? null,
      position_number: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotPlanInfo', 'positionNumber']) ?? null,
      biddingdt: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:submissionCloseDateTime']) ?? null,
      summarizingdt: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:placingProcedure', 'ns2:summingupDateTime']) ?? null,
      purchase_procedure_type: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:purchaseCodeName']) ?? null,
      plan_registration_number: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotPlanInfo', 'planRegistrationNumber']) ?? null,
      plan_guid: get(root, ['ns2:body', 'ns2:item', '_unifiedData', 'ns2:lots', 'lot', 'lotPlanInfo', 'planGuid']) ?? null,
    };
  }

  private toNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const s = String(value).trim();
    if (!s) return null;
    const normalized = s.replace(/\s+/g, '').replace(',', '.');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }
}
