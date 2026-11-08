import { getD1 } from './index';
import { ensureSchema } from './storage';
import { queryBookmarkLibrary, type LibraryQuery, type SqlRunner } from '@/lib/bookmark-library';

export async function loadBookmarkLibrary(ownerId: string, query: LibraryQuery) {
  await ensureSchema();
  const d1 = getD1();
  const db: SqlRunner = {
    all: async (sql, values) => {
      const result = await d1.prepare(sql).bind(...values).all<Record<string, unknown>>();
      return result.results;
    },
  };
  return queryBookmarkLibrary(db, ownerId, query);
}
