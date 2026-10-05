import { getD1 } from './index';
import { ensureSchema } from './storage';
import type { LibraryBookmark, LibraryPage, LibraryQuery } from '@/lib/bookmark-library';
import { bookmarkLibraryStatements } from '@/lib/bookmark-library-sql';

export async function loadBookmarkLibrary(ownerId: string, options: LibraryQuery): Promise<LibraryPage> {
  await ensureSchema();
  const db = getD1();
  const [bookmarks, count, collection, topics] = await db.batch(
    bookmarkLibraryStatements(ownerId, options).map(({ sql, values }) => db.prepare(sql).bind(...values)),
  );
  const total = Number((count.results[0] as { total?: number } | undefined)?.total ?? 0);
  const items = (bookmarks.results as unknown as Array<Omit<LibraryBookmark, 'topics'> & { topicsJson: string }>).map((row) => ({
    postId: row.postId, authorId: row.authorId, authorUsername: row.authorUsername, authorName: row.authorName,
    text: row.text, createdAt: row.createdAt, importedAt: row.importedAt,
    topics: JSON.parse(row.topicsJson) as LibraryBookmark['topics'],
  }));
  return {
    items, total, collectionTotal: Number((collection.results[0] as { total?: number } | undefined)?.total ?? 0),
    topics: topics.results as unknown as LibraryPage['topics'],
    nextOffset: options.offset + items.length < total ? options.offset + items.length : null,
  };
}
