// Requires the test-only fixture route in a secret-free preview on port 3012.
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:3012';
const seeded = await fetch(`${origin}/api/test-search`, { method: 'POST' });
assert.equal(seeded.status, 200);
const cookie = seeded.headers.get('set-cookie').split(';')[0];
const search = async (params = {}) => {
  const response = await fetch(`${origin}/api/bookmarks?${new URLSearchParams(params)}`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.match(response.headers.get('server-timing'), /auth;dur=[\d.]+, library;dur=[\d.]+/);
  return response.json();
};
const first = await search({ q: 'machine learning' });
assert.equal(first.total, 66);
assert.equal(first.collectionTotal, 67);
assert.equal(first.items[0].postId, 'best');
assert.equal(first.items.length, 30);
assert.equal(first.nextOffset, 30);
assert.equal('relevance' in first.items[0], false);
const second = await search({ q: 'machine learning', offset: '30' });
const third = await search({ q: 'machine learning', offset: '60' });
assert.equal(new Set([...first.items, ...second.items, ...third.items].map((item) => item.postId)).size, 66);
assert.equal(third.nextOffset, null);
assert.deepEqual((await search({ q: '"machine learning"' })).items.map((item) => item.postId), ['best']);
assert.equal((await search({ q: 'machine learning', sort: 'imported' })).items[0].postId, 'loose-064');
assert.equal((await search({ q: 'machine learning', sort: 'newest' })).items[0].postId, 'loose-064');
assert.equal((await search({ q: 'machine learning', sort: 'oldest' })).items[0].postId, 'best');
assert.equal((await search({ q: 'machine learning', topic: '__untagged' })).total, 65);
assert.equal((await search({ q: 'machine learning', topic: 'ml' })).total, 1);
assert.equal((await search({ q: 'machine learning', since: '10' })).total, 65);
assert.deepEqual((await search({ q: '%' })).items.map((item) => item.postId), ['literal']);
assert.deepEqual((await search({ q: '_' })).items.map((item) => item.postId), ['literal']);
assert.equal((await search({ q: 'private' })).total, 0);
const anonymous = await fetch(`${origin}/api/bookmarks?q=machine`);
assert.equal(anonymous.status, 401);
assert.match(anonymous.headers.get('cache-control'), /private, no-store/);
console.log('D1 library API passed: relevance, 3 pages, phrase search, metadata, literal punctuation, date sorts, filters, owner isolation and private responses.');
