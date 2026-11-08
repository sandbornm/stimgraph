import type { StoredBookmark } from '@/db/storage';
import { iterateXBookmarks } from './x-bookmarks.ts';

// X can return 99 posts and omit next_token when max_results is 100.
export const MANUAL_PAGE_SIZE = 20;

export type ImportCursorStore = {
  read: () => Promise<string | null>;
  write: (cursor: string | null) => Promise<void>;
};

export type ManualImportPage = {
  items: StoredBookmark[];
  nextToken: string | null;
  page: number;
};

export type ManualImportResult = {
  imported: number;
  cursor: string | null;
  error?: string;
};

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Bookmark sync failed.';
}

function withResume(message: string, cursor: string | null) {
  if (!cursor) return message;
  return `${message} Saved pages stay imported. Sync again to continue.`;
}

// A short page is our limit, not X ending. X can omit next_token on that
// request, so a missing token must keep the cursor that fetched the page.
export function cursorAfterPage({
  previous,
  nextToken,
  itemCount,
  pageSize,
}: {
  previous: string | null;
  nextToken: string | null;
  itemCount: number;
  pageSize: number;
}): string | null {
  if (nextToken) return nextToken;
  if (itemCount > 0 && pageSize < MANUAL_PAGE_SIZE) return previous;
  return null;
}

export async function importOwnerBookmarks({
  accessToken,
  userId,
  limit,
  store,
  onPage,
}: {
  accessToken: string;
  userId: string;
  limit: number;
  store: ImportCursorStore;
  onPage: (page: ManualImportPage) => Promise<void>;
}): Promise<ManualImportResult> {
  let cursor = await store.read();
  let imported = 0;
  let page = 0;
  try {
    while (imported < limit) {
      const pageSize = Math.min(MANUAL_PAGE_SIZE, limit - imported);
      const generator = iterateXBookmarks({
        accessToken,
        userId,
        limit: pageSize,
        pageSize,
        startToken: cursor ?? undefined,
      });
      const step = await generator.next();
      if (step.done || !step.value) break;
      const items = step.value.bookmarks;
      const reported = step.value.nextToken ?? null;
      const nextToken = cursorAfterPage({
        previous: cursor,
        nextToken: reported,
        itemCount: items.length,
        pageSize,
      });
      if (items.length === 0 && nextToken === cursor) break;
      page += 1;
      await onPage({ items, nextToken, page });
      imported += items.length;
      await store.write(nextToken);
      cursor = nextToken;
      if (!nextToken || (pageSize < MANUAL_PAGE_SIZE && !reported)) break;
    }
    return { imported, cursor };
  } catch (error) {
    return { imported, cursor, error: withResume(failureMessage(error), cursor) };
  }
}
