import { LIBRARY_PAGE_SIZE, libraryFilter, libraryOrder, type LibraryQuery } from './bookmark-library.ts';
import { bookmarkSearchRank } from './bookmark-search.ts';

export function bookmarkLibraryStatements(ownerId: string, options: LibraryQuery) {
  const { where, values } = libraryFilter(ownerId, options);
  const rank = bookmarkSearchRank(options.sort === 'relevance' ? options.query : '');
  return [
    { sql: `SELECT b.post_id AS postId, b.author_id AS authorId, b.author_username AS authorUsername,
      b.author_name AS authorName, b.text, b.created_at AS createdAt, b.synced_at AS importedAt, ${rank.sql} AS relevance,
      (SELECT json_group_array(json_object('id', t.id, 'label', t.label, 'confidence', bt.confidence))
        FROM bookmark_topics bt JOIN topics t ON t.owner_id = bt.owner_id AND t.id = bt.topic_id
        WHERE bt.owner_id = b.owner_id AND bt.post_id = b.post_id) AS topicsJson
      FROM bookmarks b WHERE ${where} ORDER BY ${libraryOrder(options.sort)} LIMIT ? OFFSET ?`,
      values: [...rank.values, ...values, LIBRARY_PAGE_SIZE, options.offset] },
    { sql: `SELECT COUNT(*) AS total FROM bookmarks b WHERE ${where}`, values },
    { sql: 'SELECT COUNT(*) AS total FROM bookmarks WHERE owner_id = ?', values: [ownerId] },
    { sql: `SELECT t.id, t.label, COUNT(*) AS count FROM topics t
      JOIN bookmark_topics bt ON bt.owner_id = t.owner_id AND bt.topic_id = t.id
      WHERE t.owner_id = ? GROUP BY t.id, t.label ORDER BY t.label COLLATE NOCASE`, values: [ownerId] },
  ];
}
