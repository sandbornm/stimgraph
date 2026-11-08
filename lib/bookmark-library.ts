// Server-side bookmark library query. Saved time is bookmark_observations.observed_at.

export type LibrarySort = 'saved_desc' | 'saved_asc' | 'posted' | 'author';

export type LibraryQuery = {
  q: string;
  sort: LibrarySort;
  topics: string[];
  author: string;
  limit: number;
  offset: number;
};

export type LibraryBookmark = {
  id: string;
  author: string;
  handle: string;
  text: string;
  createdAt: string | null;
  url: string;
  topics: Array<{ id: string; label: string }>;
};

export type LibraryTopicCount = { id: string; label: string; count: number };

export type LibraryPage = {
  bookmarks: LibraryBookmark[];
  total: number;
  matched: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  sort: LibrarySort;
  topics: LibraryTopicCount[];
};

export type SqlRunner = {
  all(sql: string, values: Array<string | number>): Promise<Array<Record<string, unknown>>>;
};

const SORTS: readonly LibrarySort[] = ['saved_desc', 'saved_asc', 'posted', 'author'];

export function parseLibraryQuery(params: URLSearchParams): LibraryQuery {
  const requested = params.get('sort');
  const sort = SORTS.includes(requested as LibrarySort) ? requested as LibrarySort : 'saved_desc';
  const limitRaw = Number(params.get('limit'));
  const offsetRaw = Number(params.get('offset'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 50;
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.min(1_000_000, Math.floor(offsetRaw)) : 0;
  const topics = (params.get('topic') ?? '').split(',').map((topic) => topic.trim()).filter(Boolean).slice(0, 12);
  const author = (params.get('author') ?? '').replace(/^@/, '').trim().slice(0, 80);
  return { q: (params.get('q') ?? '').trim().slice(0, 200), sort, topics, author, limit, offset };
}

export function librarySearchParams(input: {
  q: string; sort: LibrarySort; topics: string[]; author?: string; limit: number; offset: number;
}) {
  const params = new URLSearchParams();
  if (input.q.trim()) params.set('q', input.q.trim());
  params.set('sort', input.sort);
  params.set('limit', String(input.limit));
  params.set('offset', String(input.offset));
  if (input.topics.length) params.set('topic', input.topics.join(','));
  const author = (input.author ?? '').replace(/^@/, '').trim();
  if (author) params.set('author', author);
  return params;
}

function searchTerms(query: string) {
  return query.split(/\s+/).map((term) => term.replace(/^@/, '')).filter(Boolean);
}

function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, '\\$&')}%`;
}

function orderBy(sort: LibrarySort) {
  if (sort === 'saved_asc') return 'COALESCE(o.observed_at, 0) ASC, b.post_id ASC';
  if (sort === 'posted') return 'b.created_at IS NULL, b.created_at DESC, b.post_id DESC';
  if (sort === 'author') return 'b.author_username COLLATE NOCASE ASC, b.author_name COLLATE NOCASE ASC, b.post_id ASC';
  return 'COALESCE(o.observed_at, 0) DESC, b.post_id DESC';
}

function filters(ownerId: string, query: LibraryQuery) {
  const clauses = ['b.owner_id = ?'];
  const values: Array<string | number> = [ownerId];
  if (query.author) {
    clauses.push('b.author_username = ? COLLATE NOCASE');
    values.push(query.author);
  }
  for (const topic of query.topics) {
    clauses.push(`EXISTS (
      SELECT 1 FROM bookmark_topics bt
      WHERE bt.owner_id = b.owner_id AND bt.post_id = b.post_id AND bt.topic_id = ?)`);
    values.push(topic);
  }
  for (const term of searchTerms(query.q)) {
    const pattern = likePattern(term);
    clauses.push(`(
      b.text LIKE ? ESCAPE '\\'
      OR b.author_username LIKE ? ESCAPE '\\'
      OR b.author_name LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM bookmark_topics bt
        JOIN topics t ON t.owner_id = bt.owner_id AND t.id = bt.topic_id
        WHERE bt.owner_id = b.owner_id AND bt.post_id = b.post_id AND t.label LIKE ? ESCAPE '\\'
      ))`);
    values.push(pattern, pattern, pattern, pattern);
  }
  return { where: clauses.join(' AND '), values };
}

const FROM = `FROM bookmarks b
  LEFT JOIN bookmark_observations o ON o.owner_id = b.owner_id AND o.post_id = b.post_id`;

function topicsOf(value: unknown): LibraryBookmark['topics'] {
  if (Array.isArray(value)) return value.flatMap((topic) => {
    if (!topic || typeof topic !== 'object') return [];
    const row = topic as { id?: unknown; label?: unknown };
    return typeof row.id === 'string' && typeof row.label === 'string' ? [{ id: row.id, label: row.label }] : [];
  });
  if (typeof value !== 'string' || !value) return [];
  try {
    return topicsOf(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

export async function queryBookmarkLibrary(db: SqlRunner, ownerId: string, query: LibraryQuery): Promise<LibraryPage> {
  const { where, values } = filters(ownerId, query);
  const [rows, matchedRows, totalRows, topicRows] = await Promise.all([
    db.all(`SELECT b.post_id AS id, b.author_name AS author, b.author_username AS handle,
        b.text AS text, b.created_at AS createdAt,
        COALESCE((SELECT json_group_array(json_object('id', t.id, 'label', t.label))
          FROM bookmark_topics bt JOIN topics t ON t.owner_id = bt.owner_id AND t.id = bt.topic_id
          WHERE bt.owner_id = b.owner_id AND bt.post_id = b.post_id), '[]') AS topicsJson
      ${FROM} WHERE ${where} ORDER BY ${orderBy(query.sort)} LIMIT ? OFFSET ?`,
      [...values, query.limit, query.offset]),
    db.all(`SELECT COUNT(*) AS n ${FROM} WHERE ${where}`, values),
    db.all('SELECT COUNT(*) AS n FROM bookmarks WHERE owner_id = ?', [ownerId]),
    db.all(`SELECT t.id AS id, t.label AS label, COUNT(*) AS count
      FROM topics t
      JOIN bookmark_topics bt ON bt.owner_id = t.owner_id AND bt.topic_id = t.id
      JOIN bookmarks b ON b.owner_id = bt.owner_id AND b.post_id = bt.post_id
      LEFT JOIN bookmark_observations o ON o.owner_id = b.owner_id AND o.post_id = b.post_id
      WHERE ${where} GROUP BY t.id, t.label ORDER BY count DESC, t.label COLLATE NOCASE LIMIT 40`, values),
  ]);
  const bookmarks = rows.map((row) => ({
    id: String(row.id),
    author: String(row.author),
    handle: String(row.handle),
    text: String(row.text),
    createdAt: row.createdAt == null ? null : String(row.createdAt),
    url: `https://x.com/${row.handle}/status/${row.id}`,
    topics: topicsOf(row.topicsJson),
  }));
  const matched = Number(matchedRows[0]?.n ?? 0);
  const nextOffset = query.offset + bookmarks.length < matched ? query.offset + bookmarks.length : null;
  return {
    bookmarks,
    total: Number(totalRows[0]?.n ?? 0),
    matched,
    offset: query.offset,
    limit: query.limit,
    nextOffset,
    sort: query.sort,
    topics: topicRows.flatMap((row) => typeof row.id === 'string' && typeof row.label === 'string'
      ? [{ id: row.id, label: row.label, count: Number(row.count ?? 0) }] : []),
  };
}
