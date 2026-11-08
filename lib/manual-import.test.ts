import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { iterateXBookmarks } from './x-bookmarks.ts';
import { MANUAL_PAGE_SIZE, importOwnerBookmarks } from './manual-import.ts';

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
});
