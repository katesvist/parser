const { NestFactory } = require('@nestjs/core');
const { Client } = require('pg');
const { WorkerAnalyticsModule } = require('/app/dist/apps/worker-analytics/apps/worker-analytics/src/worker-analytics.module');
const { AnalyticsTask } = require('/app/dist/apps/worker-analytics/apps/worker-analytics/src/analytics.task');

const SWEEP_DELAY_MS = Number(process.env.FULL_SWEEP_DELAY_MS || 500);
const MAX_LOOPS = Number(process.env.FULL_SWEEP_MAX_LOOPS || 2000);
const LOOKBACK_DAYS = Number(process.env.RECONCILE_LOOKBACK_DAYS || 180);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pendingCount(client, sweepStartIso) {
  const res = await client.query(
    `SELECT count(*)::int AS cnt
     FROM public.tenders_gov
     WHERE COALESCE(is_terminal, false) = false
       AND (last_full_parsed_at IS NOT NULL OR rss_updated_at IS NOT NULL)
       AND COALESCE(last_full_parsed_at, rss_updated_at) >= now() - make_interval(days => $1)
       AND COALESCE(last_reconciled_at, to_timestamp(0)) < $2::timestamptz;`,
    [LOOKBACK_DAYS, sweepStartIso],
  );
  return Number(res.rows[0]?.cnt || 0);
}

async function main() {
  const sweepStart = new Date();
  const sweepStartIso = sweepStart.toISOString();
  console.log(`[SWEEP] started at ${sweepStartIso}`);

  const pg = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
  });
  await pg.connect();

  const app = await NestFactory.createApplicationContext(WorkerAnalyticsModule, {
    logger: ['log', 'warn', 'error'],
  });
  const task = app.get(AnalyticsTask);

  let loop = 0;
  let prev = await pendingCount(pg, sweepStartIso);
  console.log(`[SWEEP] initial_pending=${prev}`);

  while (loop < MAX_LOOPS && prev > 0) {
    loop += 1;
    const t0 = Date.now();
    await task.handleCron();
    const next = await pendingCount(pg, sweepStartIso);
    const spentSec = Math.round((Date.now() - t0) / 1000);
    const processed = prev - next;
    console.log(`[SWEEP] loop=${loop} processed=${processed} pending=${next} step_sec=${spentSec}`);

    if (processed <= 0) {
      console.log('[SWEEP] no progress in this loop, sleeping longer (possible lock or empty batch).');
      await sleep(Math.max(5000, SWEEP_DELAY_MS));
    } else {
      await sleep(SWEEP_DELAY_MS);
    }
    prev = next;
  }

  console.log(`[SWEEP] finished loops=${loop} remaining=${prev}`);
  await app.close();
  await pg.end();
}

main().catch((err) => {
  console.error('[SWEEP] fatal:', err);
  process.exit(1);
});
