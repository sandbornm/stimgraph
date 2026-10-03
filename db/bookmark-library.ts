import { getD1 } from './index';
import { ensureSchema } from './storage';
import { LIBRARY_PAGE_SIZE, libraryFilter, libraryOrder, type LibraryBookmark, type LibraryPage, type LibraryQuery } from '@/lib/bookmark-library';

export async function loadBookmarkLibrary(ownerId: string, options: LibraryQuery): Promise<LibraryPage> {
  await ensureSchema();
  const db = getD1();
  const { where, values } = libraryFilter(ownerId, options);
  const [bookmarks, count, collection, topics] = await db.batch([
    db.prepare(`SELECT b.post_id AS postId, b.author_id AS authorId, b.author_username AS authorUsername,
      b.author_name AS authorName, b.text, b.created_at AS createdAt, b.synced_at AS importedAt,
      (SELECT json_group_array(json_object('id', t.id, 'label', t.label, 'confidence', bt.confidence))
        FROM bookmark_topics bt JOIN topics t ON t.owner_id = bt.owner_id AND t.id = bt.topic_id
        WHERE bt.owner_id = b.owner_id AND bt.post_id = b.post_id) AS topicsJson
      FROM bookmarks b WHERE ${where} ORDER BY ${libraryOrder(options.sort)} LIMIT ? OFFSET ?`)
      .bind(...values, LIBRARY_PAGE_SIZE, options.offset),
    db.prepare(`SELECT COUNT(*) AS total FROM bookmarks b WHERE ${where}`).bind(...values),
    db.prepare('SELECT COUNT(*) AS total FROM bookmarks WHERE owner_id = ?').bind(ownerId),
    db.prepare(`SELECT t.id, t.label, COUNT(*) AS count FROM topics t
      JOIN bookmark_topics bt ON bt.owner_id = t.owner_id AND bt.topic_id = t.id
      WHERE t.owner_id = ? GROUP BY t.id, t.label ORDER BY t.label COLLATE NOCASE`).bind(ownerId),
  ]);
  const total = Number((count.results[0] as { total?: number } | undefined)?.total ?? 0);
  const items = (bookmarks.results as unknown as Array<Omit<LibraryBookmark, 'topics'> & { topicsJson: string }>).map(({ topicsJson, ...item }) => ({
    ...item, topics: JSON.parse(topicsJson) as LibraryBookmark['topics'],
  }));
  return {
    items, total, collectionTotal: Number((collection.results[0] as { total?: number } | undefined)?.total ?? 0),
    topics: topics.results as unknown as LibraryPage['topics'],
    nextOffset: options.offset + items.length < total ? options.offset + items.length : null,
  };
}
