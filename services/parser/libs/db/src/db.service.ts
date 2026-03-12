import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult } from 'pg';

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      max: process.env.PGPOOL_MAX ? Number(process.env.PGPOOL_MAX) : 10,
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async query<T = any>(text: string, params: any[] = [], client?: PoolClient): Promise<QueryResult<T>> {
    if (client) {
      return client.query<T>(text, params);
    }
    return this.pool.query<T>(text, params);
  }

  async withTransaction<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
    await client.query('BEGIN');
    try {
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  async withAdvisoryLock<T>(key: string, fn: (client: PoolClient) => Promise<T>): Promise<T | null> {
    return this.withClient(async (client) => {
      const lockResult = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked;',
        [key],
      );

      if (!lockResult.rows[0]?.locked) {
        this.logger.warn(`Advisory lock not acquired: ${key}`);
        return null;
      }

      try {
        return await fn(client);
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1));', [key]);
      }
    });
  }
}
