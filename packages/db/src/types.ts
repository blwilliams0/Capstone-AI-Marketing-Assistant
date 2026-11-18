export interface Db {
  /** Run one parameterised statement and return its rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run a multi-statement script (no parameters). Used by migrations. */
  exec(sql: string): Promise<void>;
  /** Run fn inside a transaction; rolls back if fn throws. */
  transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}
