// Pure helpers for the bookmark table and the read-only agent API.
// No I/O here so the UI, the agent routes, and tests share one behavior.

export type TableTopic = { id: string; label: string };

export type TableRow = {
  id: string;
  author: string;
  handle: string;
  text: string;
  createdAt: string | null;
  url: string;
  topics: TableTopic[];
  /** Why it was saved (Jev): try | read | reference | inspiration; null when unlabeled or unsure. */
  intent?: Intent | null;
  /** true = time-bound news that went stale, false = still actionable, null = unknown. */
  stale?: boolean | null;
};

export const INTENTS = ['try', 'read', 'reference', 'inspiration'] as const;
export type Intent = (typeof INTENTS)[number];
export const asIntent = (value: unknown): Intent | null => (INTENTS as readonly unknown[]).includes(value) ? value as Intent : null;
export const asStale = (value: unknown): boolean | null => value === 1 || value === true ? true : value === 0 || value === false ? false : null;

export type TopicCount = TableTopic & { count: number };

const STOPWORDS = new Set(('a an and are as at be but by for from has have how i if in into is it its just like more my new no not of on or our out so than that the their them then there these they this to up us was we what when which who why will with you your about after all also any can do does get got here im it’s just make most much now one only over really should some still thing think very via way would rt amp https http co been being were had did done going want need even every other first back see good great people person time times today day days week year years work post posts know thanks thank lol yes yeah right well many much less lot lots something anything everything things look looks big little best better because where while before since through again never always maybe ever own same each both few those let use used using said says say tell made makes making take come gonna dont doesnt cant isnt youre thats theres heres whats').split(' '));

function slugTopic(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

/** Simple keyword clustering fallback for rows that have no stored topics. */
export function keywordTopics(rows: TableRow[], maxTopics = 12, minCount = 3): TableRow[] {
  const untagged = rows.filter((row) => row.topics.length === 0);
  if (untagged.length === 0) return rows;
  const tokensByRow = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const row of untagged) {
    const tokens = new Set(
      row.text.toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[@][\w_]+/g, ' ')
        .match(/#?[a-z][a-z0-9+.-]{2,}/g)?.map((t) => t.replace(/^#/, '').replace(/[.-]+$/, ''))
        .map((t) => t.replace(/['’]/g, '')).filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d/.test(t)) ?? [],
    );
    tokensByRow.set(row.id, tokens);
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const keywords = [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTopics)
    .map(([word]) => word);
  return rows.map((row) => {
    if (row.topics.length) return row;
    const tokens = tokensByRow.get(row.id) ?? new Set();
    const topics = keywords.filter((word) => tokens.has(word)).slice(0, 3).map((word) => ({ id: `kw-${slugTopic(word)}`, label: word }));
    return topics.length ? { ...row, topics } : row;
  });
}

export function topicCounts(rows: TableRow[]): TopicCount[] {
  const map = new Map<string, TopicCount>();
  for (const row of rows) for (const topic of row.topics) {
    const entry = map.get(topic.id) ?? { ...topic, count: 0 };
    entry.count += 1;
    map.set(topic.id, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function intentCounts(rows: TableRow[]) {
  return INTENTS.map((id) => ({ id, count: rows.filter((row) => row.intent === id).length })).filter((c) => c.count > 0);
}

/** stale: 'include' (default, all rows), 'hide' (drop rows flagged stale), 'only' (just stale rows). */
export type StaleMode = 'include' | 'hide' | 'only';
export const asStaleMode = (value: string | null | undefined): StaleMode => value === 'hide' || value === 'only' ? value : 'include';

export type TableFilter = { q?: string; topics?: string[]; author?: string; intents?: string[]; stale?: StaleMode };

export function filterRows(rows: TableRow[], filter: TableFilter): TableRow[] {
  const terms = (filter.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const topics = (filter.topics ?? []).filter(Boolean);
  const author = (filter.author ?? '').replace(/^@/, '').toLowerCase();
  const intents = (filter.intents ?? []).map((i) => i.toLowerCase()).filter(Boolean);
  const stale = filter.stale ?? 'include';
  if (!terms.length && !topics.length && !author && !intents.length && stale === 'include') return rows;
  return rows.filter((row) => {
    if (stale === 'hide' && row.stale === true) return false;
    if (stale === 'only' && row.stale !== true) return false;
    if (intents.length && !intents.includes(row.intent ?? '')) return false;
    if (author && row.handle.toLowerCase() !== author) return false;
    if (topics.length && !topics.every((id) => row.topics.some((t) => t.id === id || t.label.toLowerCase() === id.toLowerCase()))) return false;
    if (!terms.length) return true;
    const hay = `${row.text} ${row.author} @${row.handle} ${row.topics.map((t) => t.label).join(' ')}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

export function clampLimit(value: string | null | undefined, fallback = 50, max = 500) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

type GraphLikeNode = { id: string; kind: string; label: string; note?: string; evidence?: string; url?: string };
type GraphLikeEdge = { from: string; to: string };

/** Build rows from an in-memory graph (demo/shared mode, no DB). */
export function rowsFromGraph(nodes: GraphLikeNode[], edges: GraphLikeEdge[]): TableRow[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const topicsFor = new Map<string, TableTopic[]>();
  const authorFor = new Map<string, GraphLikeNode>();
  for (const edge of edges) {
    const [a, b] = [byId.get(edge.from), byId.get(edge.to)];
    if (!a || !b) continue;
    const [source, other] = a.kind === 'source' ? [a, b] : b.kind === 'source' ? [b, a] : [null, null];
    if (!source || !other) continue;
    if (other.kind === 'topic') {
      const list = topicsFor.get(source.id) ?? [];
      if (!list.some((t) => t.id === other.id)) list.push({ id: other.id.replace(/^topic:/, ''), label: other.label });
      topicsFor.set(source.id, list);
    } else if (other.kind === 'person') authorFor.set(source.id, other);
  }
  return nodes.filter((node) => node.kind === 'source').map((node) => {
    const person = authorFor.get(node.id);
    const [name, handlePart] = (person?.label ?? '').split(' · @');
    const handle = handlePart ?? node.url?.match(/x\.com\/([^/]+)/)?.[1] ?? node.evidence?.match(/@([\w_]+)/)?.[1] ?? 'unknown';
    const dateMatch = node.evidence?.match(/·\s*([A-Z][a-z]{2} \d{4})/)?.[1];
    return {
      id: node.id.replace(/^bookmark:/, ''),
      author: name || handle,
      handle,
      text: node.note || node.label,
      createdAt: dateMatch ? new Date(`1 ${dateMatch}`).toISOString() : null,
      url: node.url ?? '',
      topics: topicsFor.get(node.id) ?? [],
      intent: null,
      stale: null,
    };
  });
}

export function rowsToMarkdown(rows: TableRow[]) {
  const esc = (v: string) => v.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const lines = ['| Date | Author | Post | Topics | Why saved | Stale |', '| --- | --- | --- | --- | --- | --- |'];
  for (const row of rows) {
    const stale = row.stale === true ? 'stale' : row.stale === false ? 'actionable' : '';
    lines.push(`| ${row.createdAt?.slice(0, 10) ?? ''} | @${esc(row.handle)} | [${esc(row.text).slice(0, 160)}](${row.url}) | ${row.topics.map((t) => esc(t.label)).join(', ')} | ${row.intent ?? ''} | ${stale} |`);
  }
  return `${lines.join('\n')}\n`;
}
