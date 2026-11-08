import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { iterateXBookmarks } from './x-bookmarks.ts';
import { MANUAL_PAGE_SIZE, cursorAfterPage, importOwnerBookmarks } from './manual-import.ts';

const post = (id: string) => ({ id, text: `Saved ${id}`, author_id: 'author' });

function collection(count: number) {
  return Array.from({ length: count }, (_, index) => post(String(index + 1)));
}

function pageResponse(items: ReturnType<typeof collection>, offset: number, size: number) {
  const data = items.slice(offset, offset + size);
  const next = offset + data.length;
  return Response.json({
    data,
    includes: { users: [{ id: 'author', username: 'reader', name: 'Reader' }] },
    meta: { result_count: data.length, ...(next < items.length ? { next_token: String(next) } : {}) },
  });
}

function memoryStore(initial: string | null = null) {
  let cursor = initial;
  const writes: Array<string | null> = [];
  return {
    writes,
    current: () => cursor,
    read: async () => cursor,
    write: async (next: string | null) => {
      cursor = next;
      writes.push(next);
    },
  };
}

describe('manual bookmark import', () => {
  it('requests pages of 20 and leaves the background default at 100', async () => {
    assert.equal(MANUAL_PAGE_SIZE, 20);
    const sizes: number[] = [];
    mock.method(globalThis, 'fetch', async (url: URL) => {
      sizes.push(Number(url.searchParams.get('max_results')));
      return Response.json({ data: [post('only')], includes: { users: [] } });
    });
    try {
      const manual = iterateXBookmarks({ accessToken: 'inert', userId: 'me', limit: 20, pageSize: MANUAL_PAGE_SIZE });
      await manual.next();
      const background = iterateXBookmarks({ accessToken: 'inert', userId: 'me', limit: 100 });
      await background.next();
      assert.deepEqual(sizes, [20, 100]);
    } finally {
      mock.restoreAll();
    }
  });

  it('keeps the last good cursor when a later page fails, then resumes there', async () => {
    const items = collection(45);
    let calls = 0;
    let failSecondPage = true;
    const seen: Array<string | null> = [];
    const sizes: number[] = [];
    mock.method(globalThis, 'fetch', async (url: URL) => {
      calls += 1;
      const token = url.searchParams.get('pagination_token');
      seen.push(token);
      sizes.push(Number(url.searchParams.get('max_results')));
      if (failSecondPage && calls === 2) return new Response('unavailable', { status: 503 });
      const offset = Number(token ?? '0');
      return pageResponse(items, offset, Number(url.searchParams.get('max_results')));
    });
    const store = memoryStore();
    const storedPages: string[][] = [];
    try {
      const failed = await importOwnerBookmarks({
        accessToken: 'inert-test-token',
        userId: 'me',
        limit: 45,
        store,
        onPage: async (page) => { storedPages.push(page.items.map((item) => item.postId)); },
      });
      assert.equal(failed.cursor, '20');
      assert.deepEqual(store.writes, ['20']);
      assert.equal(store.current(), '20');
      assert.equal(failed.imported, 20);
      assert.match(failed.error ?? '', /503/);
      assert.match(failed.error ?? '', /Sync again to continue/);
      assert.deepEqual(storedPages, [items.slice(0, 20).map((item) => item.id)]);
      assert.deepEqual(sizes, [20, 20]);

      failSecondPage = false;
      const resumed = await importOwnerBookmarks({
        accessToken: 'inert-test-token',
        userId: 'me',
        limit: 45,
        store,
        onPage: async (page) => { storedPages.push(page.items.map((item) => item.postId)); },
      });
      assert.equal(resumed.error, undefined);
      assert.equal(resumed.cursor, null);
      assert.equal(store.current(), null);
      assert.deepEqual(seen.slice(2), ['20', '40']);
      assert.deepEqual(sizes.slice(2), [20, 20]);
      assert.equal(resumed.imported, 25);
    } finally {
      mock.restoreAll();
    }
  });

  it('does not advance the cursor when the first page or the save fails', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 500 }));
    const fresh = memoryStore();
    try {
      const failed = await importOwnerBookmarks({
        accessToken: 'inert-test-token', userId: 'me', limit: 40, store: fresh, onPage: async () => {},
      });
      assert.equal(failed.cursor, null);
      assert.deepEqual(fresh.writes, []);
      assert.match(failed.error ?? '', /500/);
      assert.doesNotMatch(failed.error ?? '', /Sync again to continue/);
    } finally {
      mock.restoreAll();
    }

    mock.method(globalThis, 'fetch', async () => pageResponse(collection(20), 0, 20));
    const saving = memoryStore('saved-page');
    try {
      const failed = await importOwnerBookmarks({
        accessToken: 'inert-test-token',
        userId: 'me',
        limit: 40,
        store: saving,
        onPage: async () => { throw new Error('database unavailable'); },
      });
      assert.equal(failed.cursor, 'saved-page');
      assert.equal(saving.current(), 'saved-page');
      assert.deepEqual(saving.writes, []);
      assert.match(failed.error ?? '', /database unavailable/);
      assert.match(failed.error ?? '', /Sync again to continue/);
    } finally {
      mock.restoreAll();
    }
  });

  it('keeps the last good cursor when the import limit, not X, ends on a short page', async () => {
    const items = collection(40);
    const sizes: number[] = [];
    mock.method(globalThis, 'fetch', async (url: URL) => {
      const size = Number(url.searchParams.get('max_results'));
      sizes.push(size);
      const offset = Number(url.searchParams.get('pagination_token') ?? '0');
      const data = items.slice(offset, offset + size);
      const more = offset + data.length < items.length;
      return Response.json({
        data,
        includes: { users: [{ id: 'author', username: 'reader', name: 'Reader' }] },
        meta: {
          result_count: data.length,
          ...(size >= MANUAL_PAGE_SIZE && more ? { next_token: String(offset + data.length) } : {}),
        },
      });
    });
    const store = memoryStore();
    try {
      const result = await importOwnerBookmarks({
        accessToken: 'inert-test-token',
        userId: 'me',
        limit: 25,
        store,
        onPage: async () => {},
      });
      assert.deepEqual(sizes, [20, 5]);
      assert.equal(result.error, undefined);
      assert.equal(result.imported, 25);
      assert.equal(result.cursor, '20');
      assert.equal(store.current(), '20');
      assert.equal(store.writes.includes(null), false);
    } finally {
      mock.restoreAll();
    }
  });

  it('advances an empty page to its next token instead of clearing the cursor', async () => {
    const tokens: Array<string | null> = [];
    let calls = 0;
    mock.method(globalThis, 'fetch', async (url: URL) => {
      calls += 1;
      const token = url.searchParams.get('pagination_token');
      tokens.push(token);
      if (calls === 1) {
        return Response.json({ data: [], meta: { result_count: 0, next_token: 'later' } });
      }
      return pageResponse(collection(5), 0, 20);
    });
    const store = memoryStore();
    try {
      const result = await importOwnerBookmarks({
        accessToken: 'inert-test-token',
        userId: 'me',
        limit: 20,
        store,
        onPage: async () => {},
      });
      assert.deepEqual(tokens, [null, 'later']);
      assert.equal(store.writes[0], 'later');
      assert.equal(result.error, undefined);
      assert.equal(result.imported, 5);
    } finally {
      mock.restoreAll();
    }
  });

  it('guard: never nulls a cursor a short page or an empty continuation still needs', () => {
    assert.equal(cursorAfterPage({ previous: '20', nextToken: null, itemCount: 5, pageSize: 5 }), '20');
    assert.equal(cursorAfterPage({ previous: '20', nextToken: 'later', itemCount: 0, pageSize: 20 }), 'later');
    assert.equal(cursorAfterPage({ previous: 'saved', nextToken: null, itemCount: 0, pageSize: 20 }), null);
    assert.equal(cursorAfterPage({ previous: '20', nextToken: null, itemCount: 20, pageSize: 20 }), null);
    assert.equal(cursorAfterPage({ previous: null, nextToken: 'next', itemCount: 3, pageSize: 5 }), 'next');
  });
});
