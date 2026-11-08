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

const MAX_EMPTY_PAGES = 3;

// An absent next_token means X has no further page, including after a short request.
// Keeping the previous cursor would make the next sync reread that page.
export function cursorAfterPage({ nextToken }: { nextToken: string | null }): string | null {
  return nextToken;
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
  let emptyPages = 0;
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
      if (reported !== null && reported === cursor) {
        page += 1;
        await onPage({ items, nextToken: cursor, page });
        imported += items.length;
        break;
      }
      const nextToken = cursorAfterPage({ nextToken: reported });
      if (items.length === 0) emptyPages += 1;
      page += 1;
      await onPage({ items, nextToken, page });
      imported += items.length;
      await store.write(nextToken);
      cursor = nextToken;
      if (!nextToken || (items.length === 0 && emptyPages >= MAX_EMPTY_PAGES)) break;
    }
    return { imported, cursor };
  } catch (error) {
    return { imported, cursor, error: withResume(failureMessage(error), cursor) };
  }
}
