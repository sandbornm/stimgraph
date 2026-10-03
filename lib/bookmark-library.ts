export type LibraryBookmark = {
  postId: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  text: string;
  createdAt: string | null;
  importedAt: number;
  topics: Array<{ id: string; label: string; confidence: number }>;
};

export type LibraryQuery = {
  query: string;
  topic: string;
  sort: 'imported' | 'newest' | 'oldest';
  offset: number;
  since: number;
};

export type LibraryPage = {
  items: LibraryBookmark[];
  total: number;
  collectionTotal: number;
  topics: Array<{ id: string; label: string; count: number }>;
  nextOffset: number | null;
};

export const LIBRARY_PAGE_SIZE = 30;

export function parseLibraryQuery(params: URLSearchParams): LibraryQuery {
  const offset = Number(params.get('offset') ?? 0);
  const since = Number(params.get('since') ?? 0);
  const sort = params.get('sort');
  return {
    query: (params.get('q') ?? '').trim().slice(0, 200),
    topic: (params.get('topic') ?? '').slice(0, 200),
    sort: sort === 'newest' || sort === 'oldest' ? sort : 'imported',
    offset: Number.isSafeInteger(offset) && offset >= 0 ? Math.min(offset, 1_000_000) : 0,
    since: Number.isSafeInteger(since) && since > 0 ? since : 0,
  };
}

export function libraryFilter(ownerId: string, options: LibraryQuery) {
  const clauses = ['b.owner_id = ?'];
  const values: Array<string | number> = [ownerId];
  if (options.query) {
    const pattern = `%${options.query.replace(/[\\%_]/g, '\\$&')}%`;
    clauses.push(`(b.text LIKE ? ESCAPE '\\' OR b.author_username LIKE ? ESCAPE '\\'
      OR b.author_name LIKE ? ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM bookmark_topics bt JOIN topics t ON t.owner_id = bt.owner_id AND t.id = bt.topic_id
        WHERE bt.owner_id = b.owner_id AND bt.post_id = b.post_id AND t.label LIKE ? ESCAPE '\\'))`);
    values.push(pattern, pattern, pattern, pattern);
  }
  if (options.topic === '__untagged') {
    clauses.push('NOT EXISTS (SELECT 1 FROM bookmark_topics bt WHERE bt.owner_id = b.owner_id AND bt.post_id = b.post_id)');
  } else if (options.topic) {
    clauses.push('EXISTS (SELECT 1 FROM bookmark_topics bt WHERE bt.owner_id = b.owner_id AND bt.post_id = b.post_id AND bt.topic_id = ?)');
    values.push(options.topic);
  }
  if (options.since) {
    clauses.push('b.synced_at >= ?');
    values.push(options.since);
  }
  return { where: clauses.join(' AND '), values };
}

export function libraryOrder(sort: LibraryQuery['sort']) {
  if (sort === 'oldest') return 'b.created_at IS NULL, b.created_at ASC, b.post_id ASC';
  if (sort === 'newest') return 'b.created_at IS NULL, b.created_at DESC, b.post_id DESC';
  return 'b.synced_at DESC, b.created_at DESC, b.post_id DESC';
}

export function filterDemoLibrary(items: LibraryBookmark[], options: LibraryQuery): LibraryPage {
  const topics = new Map<string, { id: string; label: string; count: number }>();
  for (const item of items) for (const topic of item.topics) {
    topics.set(topic.id, { ...topic, count: (topics.get(topic.id)?.count ?? 0) + 1 });
  }
  const needle = options.query.toLocaleLowerCase();
  const filtered = items.filter((item) => {
    if (options.since && item.importedAt < options.since) return false;
    if (options.topic === '__untagged' && item.topics.length) return false;
    if (options.topic && options.topic !== '__untagged' && !item.topics.some((topic) => topic.id === options.topic)) return false;
    return !needle || [item.text, item.authorUsername, item.authorName, ...item.topics.map((topic) => topic.label)]
      .some((value) => value.toLocaleLowerCase().includes(needle));
  }).sort((a, b) => {
    if (options.sort === 'imported' && a.importedAt !== b.importedAt) return b.importedAt - a.importedAt;
    if (!a.createdAt !== !b.createdAt) return a.createdAt ? -1 : 1;
    const byDate = (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.postId.localeCompare(b.postId);
    return options.sort === 'oldest' ? byDate : -byDate;
  });
  const end = options.offset + LIBRARY_PAGE_SIZE;
  return {
    items: filtered.slice(options.offset, end), total: filtered.length, collectionTotal: items.length,
    topics: [...topics.values()].sort((a, b) => a.label.localeCompare(b.label)),
    nextOffset: end < filtered.length ? end : null,
  };
}
