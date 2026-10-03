import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';
import { fetchXBookmarks, iterateXBookmarks } from './x-bookmarks.ts';

afterEach(() => mock.restoreAll());
const input = { accessToken: 'inert-test-token', userId: 'test-user', limit: 2 };
const post = (id: string) => ({ id, text: `Saved post ${id}`, author_id: 'author' });

it('retrieves beyond 99 when X omits continuation for 100-item requests', async () => {
  const collection = Array.from({ length: 121 }, (_, index) => post(String(index)));
  const requests: Array<{ size: number; offset: number }> = [];
  mock.method(globalThis, 'fetch', async (url: URL) => {
    const size = Number(url.searchParams.get('max_results'));
    const offset = Number(url.searchParams.get('pagination_token') ?? '0');
    requests.push({ size, offset });
    // Reproduce the observed upstream behavior instead of assuming a short
    // page without a token proves the account has no older bookmarks.
    if (size === 100) return Response.json({ data: collection.slice(0, 99), meta: { result_count: 99 } });
    const data = collection.slice(offset, offset + size);
    const nextOffset = offset + data.length;
    return Response.json({ data, meta: { result_count: data.length, ...(nextOffset < collection.length ? { next_token: String(nextOffset) } : {}) } });
  });
  const result = await fetchXBookmarks({ ...input, limit: 600 });
  assert.deepEqual(result.bookmarks.map((item) => item.postId), collection.map((item) => item.id));
  assert.equal(result.hasMore, false);
  assert.equal(result.nextToken, undefined);
  assert.deepEqual(requests.map((request) => request.offset), [0, 20, 40, 60, 80, 100, 120]);
  assert.ok(requests.every((request) => request.size === 20));
});

it('reports an upstream next page even when the request limit is reached', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ data: [post('a'), post('b')], meta: { next_token: 'next-page' } });
  });
  const result = await fetchXBookmarks(input);
  assert.equal(calls, 1);
  assert.equal(result.bookmarks.length, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextToken, 'next-page');
});

it('continues at the supplied cursor and maps authors without re-reading page one', async () => {
  mock.method(globalThis, 'fetch', async (url: URL) => {
    assert.equal(url.searchParams.get('pagination_token'), 'next-page');
    return Response.json({ data: [post('c')], includes: { users: [{ id: 'author', username: 'reader', name: 'Reader' }] } });
  });
  const result = await fetchXBookmarks({ ...input, paginationToken: 'next-page' });
  assert.deepEqual(result.bookmarks.map((item) => [item.postId, item.authorUsername]), [['c', 'reader']]);
  assert.equal(result.hasMore, false);
});

it('keeps earlier yielded pages available when a later page fails', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async () => ++calls === 1
    ? Response.json({ data: [post('a')], meta: { next_token: 'retry-page' } })
    : new Response(null, { status: 429 }));
  const pages = iterateXBookmarks(input);
  const first = await pages.next();
  assert.equal(first.value.nextToken, 'retry-page');
  await assert.rejects(pages.next(), /limited bookmark reads/);
});

it('stops repeated pagination tokens rather than repeatedly fetching the same page', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ data: [post('a')], meta: { next_token: 'repeat' } }));
  await assert.rejects(fetchXBookmarks({ ...input, limit: 10 }), /repeated a bookmark page/);
});

it('does not report an incomplete provider response as a successful empty collection', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ errors: [{ title: 'Unavailable' }] }));
  await assert.rejects(fetchXBookmarks(input), /incomplete bookmark page/);
});

it('rejects invalid import limits before any provider request', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider request'); });
  for (const limit of [NaN, Infinity, 0, -1, 1.5, 1001]) {
    await assert.rejects(fetchXBookmarks({ ...input, limit }), /between 1 and 1000/);
  }
  assert.equal(fetch.mock.callCount(), 0);
});
