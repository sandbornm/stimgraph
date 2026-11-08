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
      const nextToken = items.length > 0 ? step.value.nextToken ?? null : null;
      page += 1;
      await onPage({ items, nextToken, page });
      imported += items.length;
      await store.write(nextToken);
      cursor = nextToken;
      if (!nextToken) break;
    }
    return { imported, cursor };
  } catch (error) {
    return { imported, cursor, error: withResume(failureMessage(error), cursor) };
  }
}
