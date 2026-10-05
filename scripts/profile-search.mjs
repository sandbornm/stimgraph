// Synthetic, in-memory data only. No app configuration, credential files or providers.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = resolve(process.argv.find((value) => value.startsWith('--source='))?.slice(9) || '.');
const { bookmarkLibraryStatements } = await import(pathToFileURL(`${source}/lib/bookmark-library-sql.ts`));
const { filterDemoLibrary, parseLibraryQuery } = await import(pathToFileURL(`${source}/lib/bookmark-library.ts`));
const size = Number(process.argv.find((value) => value.startsWith('--size='))?.slice(7) || 5000);
if (!Number.isSafeInteger(size) || size < 100 || size > 50000) throw new Error('--size must be between 100 and 50000');
const db = new DatabaseSync(':memory:');
for (const file of readdirSync(`${source}/drizzle`).filter((file) => /^\d.*\.sql$/.test(file)).sort()) db.exec(readFileSync(`${source}/drizzle/${file}`, 'utf8'));
const items = [];
db.exec('BEGIN');
const insert = db.prepare(`INSERT INTO bookmarks (owner_id, post_id, author_id, author_username, author_name, text, created_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const addTopic = db.prepare('INSERT INTO topics VALUES (?, ?, ?, ?, ?)');
const assign = db.prepare('INSERT INTO bookmark_topics VALUES (?, ?, ?, 100, ?, ?)');
for (let topic = 0; topic < 20; topic++) addTopic.run('profile', String(topic), topic % 2 ? `Learning systems ${topic}` : `Machine tools ${topic}`, 'fixture', 1);
for (let index = 0; index < size; index++) {
  const item = { postId: String(index).padStart(8, '0'), authorId: String(index % 50), authorUsername: `author_${index % 50}`, authorName: `Author ${index % 50}`,
    text: `${index % 7 === 0 ? 'A guide to machine learning.' : index % 3 === 0 ? 'Learning to build a machine.' : 'Notes about archives and interfaces.'} ${'Context and evidence from a saved post. '.repeat(8)}`,
    createdAt: new Date(1700000000000 + index * 60000).toISOString(), importedAt: (index * 7919) % size, topics: [] };
  insert.run('profile', item.postId, item.authorId, item.authorUsername, item.authorName, item.text, item.createdAt, item.importedAt);
  for (const topic of [index % 20, (index + 7) % 20]) {
    const label = topic % 2 ? `Learning systems ${topic}` : `Machine tools ${topic}`;
    item.topics.push({ id: String(topic), label, confidence: 100 });
    assign.run('profile', item.postId, String(topic), 'Synthetic', 'fixture');
  }
  items.push(item);
}
db.exec('COMMIT; ANALYZE');

function measure(run) {
  for (let i = 0; i < 3; i++) run();
  const samples = Array.from({ length: 15 }, () => { const start = performance.now(); run(); return performance.now() - start; }).sort((a, b) => a - b);
  return { p50: +samples[7].toFixed(2), p95: +samples[14].toFixed(2) };
}

const rows = [];
for (const [name, params] of [
  ['recent imports', {}], ['phrase and loose matches', { q: 'machine learning' }],
  ['reordered words', { q: 'learning machine' }], ['author lookup', { q: 'author_12' }],
  ['no matches', { q: 'nonexistentquery' }], ['later page', { q: 'machine learning', offset: '300' }],
]) {
  const options = parseLibraryQuery(new URLSearchParams(params));
  const prepared = bookmarkLibraryStatements('profile', options).map(({ sql, values }) => ({ statement: db.prepare(sql), values }));
  const sql = measure(() => prepared.forEach(({ statement, values }) => statement.all(...values)));
  const demo = measure(() => filterDemoLibrary(items, options));
  rows.push({ scenario: name, sql, demo });
}
const browse = bookmarkLibraryStatements('profile', parseLibraryQuery(new URLSearchParams()))[0];
const browsePlan = db.prepare(`EXPLAIN QUERY PLAN ${browse.sql}`).all(...browse.values).map((row) => row.detail);
db.close();
if (process.argv.includes('--markdown')) {
  console.log(`Search profile: ${size.toLocaleString()} synthetic bookmarks, Node ${process.versions.node}, SQLite ${process.versions.sqlite}. Local warm timings, not production D1 latency.\n`);
  console.log('| Scenario | SQL batch p50 / p95 (ms) | Demo p50 / p95 (ms) |\n| --- | ---: | ---: |');
  for (const row of rows) console.log(`| ${row.scenario} | ${row.sql.p50} / ${row.sql.p95} | ${row.demo.p50} / ${row.demo.p95} |`);
  console.log(`\nBrowse query uses a temporary sort: ${browsePlan.some((line) => line.includes('TEMP B-TREE')) ? 'yes' : 'no'}.`);
} else console.log(JSON.stringify({ size, node: process.versions.node, sqlite: process.versions.sqlite, rows, browsePlan }, null, 2));
