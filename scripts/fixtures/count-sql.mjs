import { DatabaseSync, StatementSync } from 'node:sqlite';
import { createServer } from 'node:http';
const counts = { prepare: 0 };
const timing = new Map();
const original = DatabaseSync.prototype.prepare;
DatabaseSync.prototype.prepare = function prepare(sql) {
  counts.prepare += 1;
  return original.call(this, sql);
};
for (const method of ['all', 'get', 'run']) {
  const base = StatementSync.prototype[method];
  StatementSync.prototype[method] = function timed(...args) {
    const start = performance.now();
    try { return base.apply(this, args); } finally {
      const key = this.sourceSQL.replace(/\s+/g, ' ').slice(0, 160);
      const entry = timing.get(key) ?? { n: 0, ms: 0 };
      entry.n += 1; entry.ms += performance.now() - start;
      timing.set(key, entry);
    }
  };
}
const port = Number(process.env.STIMGRAPH_BENCH_COUNTER_PORT || 0);
if (port) {
  createServer((request, response) => {
    if (request.url === '/reset') { counts.prepare = 0; }
    if (request.url === '/reset-timing') timing.clear();
    response.setHeader('content-type', 'application/json');
    if (request.url === '/top') {
      response.end(JSON.stringify([...timing].sort((a, b) => b[1].ms - a[1].ms).slice(0, 15).map(([sql, v]) => ({ sql, n: v.n, ms: +v.ms.toFixed(1) }))));
      return;
    }
    response.end(JSON.stringify(counts));
  }).listen(port, '127.0.0.1').unref();
}
