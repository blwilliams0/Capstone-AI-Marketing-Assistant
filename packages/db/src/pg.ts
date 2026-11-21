import pg from 'pg';
import type { Db } from './types.js';

function wrapClient(client: pg.PoolClient | pg.Pool, owner?: pg.Pool): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params);
      return res.rows as T[];
    },
    async exec(sql) {
      await client.query(sql);
    },
    async transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R> {
      if (!owner) throw new Error('Nested transactions are not supported');
      const c = await owner.connect();
      try {
        await c.query('BEGIN');
        const result = await fn(wrapClient(c));
        await c.query('COMMIT');
        return result;
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      } finally {
        c.release();
      }
    },
    async close() {
      if (owner) await owner.end();
    },
  };
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
  // An idle connection dropped by the server (laptop sleep, Wi-Fi change) must not crash the
  // process: the pool discards it and opens a new one on the next query.
  pool.on('error', (err) => {
    console.error(JSON.stringify({ level: 'warn', msg: 'database connection dropped; it will reconnect', error: err.message }));
  });
  return wrapClient(pool, pool);
}
