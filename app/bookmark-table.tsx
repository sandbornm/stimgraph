'use client';

import { memo, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { librarySearchParams, type LibrarySort, type LibraryTopicCount } from '@/lib/bookmark-library';
import { filterRows, keywordTopics, rowsFromGraph, sortRows, topicCounts, type TableRow } from '@/lib/bookmark-table';
import type { GraphEdge } from '@/lib/graph-model';

type Props = {
  live: boolean;
  refreshKey: string | number;
  nodes: Array<{ id: string; kind: string; label: string; note?: string; evidence?: string; url?: string }>;
  edges: GraphEdge[];
};

const PAGE = 100;
const SORTS: Array<{ id: LibrarySort; label: string }> = [
  { id: 'saved_desc', label: 'Saved, newest' },
  { id: 'saved_asc', label: 'Saved, oldest' },
  { id: 'posted', label: 'Posted' },
  { id: 'author', label: 'Author' },
];
/** Topic source is encoded in the id prefix: jev- (Jev label), kw- (keyword fallback), else hashtag/Grok. */
const chipSource = (id: string) => (id.startsWith('jev-') ? ' jev' : id.startsWith('kw-') ? ' kw' : '');
const chipTitle = (id: string) => (id.startsWith('jev-') ? 'Topic labeled by Jev (TypeSafe AI)' : id.startsWith('kw-') ? 'Keyword topic' : 'Hashtag or Grok topic');
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function BookmarkTable({ live, refreshKey, nodes, edges }: Props) {
  const graphRows = useMemo(() => keywordTopics(rowsFromGraph(nodes, edges)), [nodes, edges]);
  const [liveRows, setLiveRows] = useState<TableRow[] | null>(null);
  const [liveTopics, setLiveTopics] = useState<LibraryTopicCount[]>([]);
  const [matched, setMatched] = useState(0);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [pageOffset, setPageOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('saved_desc');
  const [active, setActive] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);
  const deferredQuery = useDeferredValue(query);
  const activeKey = active.join('\u0000');
  const filterKey = `${deferredQuery}|${sort}|${activeKey}|${refreshKey}`;
  const [appliedFilter, setAppliedFilter] = useState(filterKey);
  if (appliedFilter !== filterKey) {
    setAppliedFilter(filterKey);
    setPageOffset(0);
  }
  const offset = appliedFilter === filterKey ? pageOffset : 0;

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    const params = librarySearchParams({ q: deferredQuery, sort, topics: active, limit: PAGE, offset });
    fetch(`/api/agent/bookmarks?${params}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ bookmarks?: TableRow[]; topics?: LibraryTopicCount[]; matched?: number; total?: number; nextOffset?: number | null }> : null))
      .then((data) => {
        if (!data?.bookmarks) return;
        setLiveRows((current) => offset === 0 ? data.bookmarks! : [...(current ?? []), ...data.bookmarks!]);
        setLiveTopics(data.topics ?? []);
        setMatched(data.matched ?? data.bookmarks.length);
        setTotal(data.total ?? data.bookmarks.length);
        setNextOffset(data.nextOffset ?? null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [live, deferredQuery, sort, active, offset, refreshKey]);

  const rows = live && liveRows ? liveRows : sortRows(graphRows, sort);
  const filtered = useMemo(() => live && liveRows ? rows : filterRows(rows, { q: deferredQuery, topics: active }), [live, liveRows, rows, deferredQuery, active]);
  const chips = useMemo(() => live && liveRows ? liveTopics.slice(0, 18) : topicCounts(filtered).slice(0, 18), [live, liveRows, liveTopics, filtered]);
  const toggle = (id: string) => {
    setShown(PAGE);
    setActive((cur) => cur.includes(id) ? cur.filter((item) => item !== id) : [...cur, id]);
  };
  const visible = live && liveRows ? filtered : filtered.slice(0, shown);
  const countLabel = live && liveRows ? `${matched} / ${total}` : `${filtered.length} / ${rows.length}`;

  return (
    <section className="bm-table" aria-label="Bookmarks table">
      <div className="bm-bar">
        <input
          type="search" value={query} placeholder="Filter bookmarks, people, topics…" aria-label="Filter bookmarks"
          onChange={(e) => { setShown(PAGE); setQuery(e.target.value); }}
        />
        <select aria-label="Sort bookmarks" value={sort} onChange={(event) => { setShown(PAGE); setSort(event.target.value as LibrarySort); }}>
          {SORTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <span className="bm-count">{countLabel}</span>
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
            {visible.map((row) => <Row key={row.id} row={row} active={active} onTopic={toggle} />)}
          </tbody>
        </table>
        {live && liveRows && nextOffset != null ? <button type="button" className="bm-more" onClick={() => setPageOffset(nextOffset)}>Show more</button> : null}
        {!live || !liveRows ? (filtered.length > shown ? <button type="button" className="bm-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, filtered.length - shown)} more</button> : null) : null}
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
