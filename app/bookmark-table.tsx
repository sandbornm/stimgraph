'use client';

import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { filterRows, keywordTopics, rowsFromGraph, topicCounts, type TableRow } from '@/lib/bookmark-table';
import type { GraphEdge } from '@/lib/graph-model';

type Props = {
  live: boolean;
  refreshKey: string | number;
  nodes: Array<{ id: string; kind: string; label: string; note?: string; evidence?: string; url?: string }>;
  edges: GraphEdge[];
};

const PAGE = 100;
/** Topic source is encoded in the id prefix: jev- (Jev label), kw- (keyword fallback), else hashtag/Grok. */
const chipSource = (id: string) => (id.startsWith('jev-') ? ' jev' : id.startsWith('kw-') ? ' kw' : '');
const chipTitle = (id: string) => (id.startsWith('jev-') ? 'Topic labeled by Jev (TypeSafe AI)' : id.startsWith('kw-') ? 'Keyword topic' : 'Hashtag or Grok topic');
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function BookmarkTable({ live, refreshKey, nodes, edges }: Props) {
  const graphRows = useMemo(() => keywordTopics(rowsFromGraph(nodes, edges)), [nodes, edges]);
  const [liveRows, setLiveRows] = useState<TableRow[] | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    fetch('/api/agent/bookmarks?limit=2000', { cache: 'no-store', signal: controller.signal })
      .then((r) => (r.ok ? r.json() as Promise<{ bookmarks?: TableRow[] }> : null))
      .then((data: { bookmarks?: TableRow[] } | null) => { if (data?.bookmarks) setLiveRows(data.bookmarks); })
      .catch(() => {});
    return () => controller.abort();
  }, [live, refreshKey]);

  const rows = live && liveRows ? liveRows : graphRows;
  const filtered = useMemo(() => filterRows(rows, { q: deferredQuery, topics: active }), [rows, deferredQuery, active]);
  const chips = useMemo(() => topicCounts(filtered).slice(0, 18), [filtered]);
  const toggle = (id: string) => { setShown(PAGE); setActive((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]); };

  return (
    <section className="bm-table" aria-label="Bookmarks table">
      <div className="bm-bar">
        <input
          type="search" value={query} placeholder="Filter bookmarks, people, topics…" aria-label="Filter bookmarks"
          onChange={(e) => { setShown(PAGE); setQuery(e.target.value); }}
        />
        <span className="bm-count">{filtered.length} / {rows.length}</span>
      </div>
      <div className="bm-chips" role="list">
        {active.map((id) => (
          <button key={`a-${id}`} type="button" className="bm-chip on" onClick={() => toggle(id)}>
            {rows.flatMap((r) => r.topics).find((t) => t.id === id)?.label ?? id} ×
          </button>
        ))}
        {chips.filter((c) => !active.includes(c.id)).map((c) => (
          <button key={c.id} type="button" className={`bm-chip${chipSource(c.id)}`} title={chipTitle(c.id)} onClick={() => toggle(c.id)}>{c.label}<small>{c.count}</small></button>
        ))}
      </div>
      <div className="bm-scroll">
        <table>
          <thead><tr><th>Author</th><th>Post</th><th>Date</th><th>Topics</th></tr></thead>
          <tbody>
            {filtered.slice(0, shown).map((row) => <Row key={row.id} row={row} active={active} onTopic={toggle} />)}
          </tbody>
        </table>
        {filtered.length > shown ? <button type="button" className="bm-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, filtered.length - shown)} more</button> : null}
        {filtered.length === 0 ? <p className="bm-empty">No bookmarks match.</p> : null}
      </div>
    </section>
  );
}

const Row = memo(function Row({ row, active, onTopic }: { row: TableRow; active: string[]; onTopic: (id: string) => void }) {
  const text = row.text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return (
    <tr>
      <td className="bm-author"><a href={`https://x.com/${row.handle}`} target="_blank" rel="noreferrer">@{row.handle}</a></td>
      <td className="bm-text"><a href={row.url} target="_blank" rel="noreferrer">{text.length > 180 ? `${text.slice(0, 179)}…` : text || 'Saved post'}</a></td>
      <td className="bm-date">{row.createdAt && !Number.isNaN(Date.parse(row.createdAt)) ? dateFmt.format(new Date(row.createdAt)) : '—'}</td>
      <td className="bm-topics">{row.topics.map((t) => (
        <button key={t.id} type="button" className={`bm-chip${chipSource(t.id)} ${active.includes(t.id) ? 'on' : ''}`} title={chipTitle(t.id)} onClick={() => onTopic(t.id)}>{t.label}</button>
      ))}</td>
    </tr>
  );
});
