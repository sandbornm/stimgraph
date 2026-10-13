// A small adapter for the D1 prepare/batch API used by this app. SQLite remains
// local; production does not run a Cloudflare development emulator.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

type Row = Record<string, unknown>;
class Statement {
  constructor(readonly database: DatabaseSync, readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.database, this.sql, values); }
  execute() {
    const statement = this.database.prepare(this.sql);
    const results = statement.columns().length ? statement.all(...this.values) : [];
    const meta = results.length || statement.columns().length
      ? { changes: Number(this.database.prepare('SELECT changes() AS n').get()?.n ?? 0) }
      : { changes: Number(statement.run(...this.values).changes) };
    return { results, success: true, meta };
  }
  async all<T = Row>() { return this.execute() as { results: T[]; success: boolean; meta: { changes: number } }; }
  async run() { return this.execute(); }
  async first<T = Row>(column?: string): Promise<T | null> {
    const result = this.database.prepare(this.sql).get(...this.values);
    return (result ? (column ? result[column] : result) : null) as T | null;
  }
  async raw() { return this.execute().results.map((row) => Object.values(row)); }
}

let local: D1Database | undefined;
export function getLocalD1(): D1Database {
  if (local) return local;
  const path = process.env.STIMGRAPH_DATABASE;
  if (!path || !isAbsolute(path)) throw new Error('STIMGRAPH_DATABASE must be an absolute path.');
  process.umask(0o077);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  local = {
    prepare: (sql: string) => new Statement(database, sql),
    async batch(statements: Statement[]) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => statement.execute());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    async exec(sql: string) { database.exec(sql); return { count: 1, duration: 0 }; },
  } as unknown as D1Database;
  return local;
}
