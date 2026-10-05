'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { filterDemoLibrary, LIBRARY_PAGE_SIZE, parseLibraryQuery, type LibraryBookmark, type LibraryPage } from '@/lib/bookmark-library';
import { bookmarkSnippet } from '@/lib/bookmark-display';

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return dateFormatter.format(new Date(value));
}

const BookmarkCard = memo(function BookmarkCard({ item, index, newSince, query, onTopic, onExplore }: {
  item: LibraryBookmark; index: number; newSince: number; query: string;
  onTopic: (topic: string) => void; onExplore: (item: LibraryBookmark) => void;
}) {
  const date = dateLabel(item.createdAt);
  const snippet = bookmarkSnippet(item.text, query);
  const excerpt = snippet.matches.flatMap(([start, end], index) => [
    snippet.text.slice(snippet.matches[index - 1]?.[1] ?? 0, start), <mark key={start}>{snippet.text.slice(start, end)}</mark>,
  ]);
  return <article className="library-card">
    <div className="library-card-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
    <div className="library-card-content">
      <div className="library-meta"><strong>{item.authorName}</strong><span>@{item.authorUsername}</span>{date ? <time dateTime={item.createdAt!}>Posted {date}</time> : null}{newSince > 0 && item.importedAt >= newSince ? <b className="library-new">NEW</b> : null}</div>
      <details className="library-reading"><summary><span>{excerpt}{snippet.text.slice(snippet.matches.at(-1)?.[1] ?? 0)}</span><small>Read saved post</small></summary><p>{item.text}</p></details>
      <div className="library-card-footer"><div className="library-topics">{item.topics.length ? item.topics.map((topic) => <button type="button" key={topic.id} onClick={() => onTopic(topic.id)}>{topic.label}</button>) : <span>No topics yet</span>}</div>
        <div className="library-card-actions"><a href={`https://x.com/${encodeURIComponent(item.authorUsername)}/status/${encodeURIComponent(item.postId)}`} target="_blank" rel="noreferrer">Original ↗</a><button type="button" onClick={() => onExplore(item)}>Explore connections <span aria-hidden="true">→</span></button></div>
      </div>
    </div>
  </article>;
});

export function BookmarkLibrary({ mode, demoItems, revision, newSince, newOnly, onNewOnlyChange, onExplore, hidden }: {
  mode: 'demo' | 'live' | 'shared';
  demoItems: LibraryBookmark[];
  revision: number;
  newSince: number;
  newOnly: boolean;
  onNewOnlyChange: (value: boolean) => void;
  onExplore: (item: LibraryBookmark) => void;
  hidden: boolean;
}) {
  const [query, setQuery] = useState('');
  const [settledQuery, setSettledQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [sort, setSort] = useState('auto');
  const [pagination, setPagination] = useState({ key: '', offset: 0 });
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; offset: number; revision: number; query: string; page: LibraryPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; offset: number; message: string } | null>(null);
  const params = useMemo(() => new URLSearchParams({ q: settledQuery, topic, sort, since: String(newOnly ? newSince : 0) }), [settledQuery, topic, sort, newOnly, newSince]);
  const key = `${params.toString()}:${revision}`;
  const offset = pagination.key === key ? pagination.offset : 0;
  const typing = query.trim() !== settledQuery;
  const local = useMemo(() => {
    if (mode === 'live') return null;
    return filterDemoLibrary(demoItems, parseLibraryQuery(params), offset + LIBRARY_PAGE_SIZE);
  }, [demoItems, params, offset, mode]);
  const page = mode === 'live' ? result?.revision === revision ? result.page : null : local;
  const error = failure?.key === key && failure.offset === offset ? failure.message : '';
  const needsRequest = !result || result.key !== key || result.offset !== offset;
  const loading = typing || (mode === 'live' && !error && needsRequest);
  const stale = typing || (mode === 'live' && result?.key !== key);
  const displayedQuery = mode === 'live' ? result?.query ?? '' : settledQuery;

  useEffect(() => {
    if (query.trim() === settledQuery) return;
    const timer = window.setTimeout(() => { setSettledQuery(query.trim()); setPagination({ key: '', offset: 0 }); }, 180);
    return () => window.clearTimeout(timer);
  }, [query, settledQuery]);

  useEffect(() => {
    if (mode !== 'live' || hidden || !needsRequest || typing) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const search = new URLSearchParams(params);
        search.set('offset', String(offset));
        const response = await fetch(`/api/bookmarks?${search}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? 'Your X connection needs attention. Reconnect X to open your library.' : 'Could not load bookmarks. Try again.');
        const data = await response.json() as LibraryPage;
        if (controller.signal.aborted) return;
        setFailure(null);
        setResult((previous) => ({
          key, offset, revision, query: settledQuery,
          page: { ...data, items: offset > 0 && previous?.key === key
            ? [...new Map([...previous.page.items, ...data.items].map((item) => [item.postId, item])).values()]
            : data.items },
        }));
      } catch (error) {
        if (!controller.signal.aborted) setFailure({ key, offset, message: error instanceof Error ? error.message : 'Could not load bookmarks.' });
      }
    })();
    return () => controller.abort();
  }, [mode, params, key, offset, retry, hidden, needsRequest, typing, revision, settledQuery]);

  const reset = () => { setQuery(''); setSettledQuery(''); setTopic(''); onNewOnlyChange(false); setPagination({ key: '', offset: 0 }); };
  const selectTopic = useCallback((value: string) => { setTopic(value); setPagination({ key: '', offset: 0 }); }, []);
  const filtered = Boolean(query.trim() || topic || newOnly);

  return <section className="bookmark-library" aria-label="Bookmark library" hidden={hidden}>
    <header className="library-heading">
      <div>
        <p className="eyebrow">{mode === 'demo' ? 'DEMO LIBRARY' : 'YOUR LIBRARY'}</p>
        <h1>Bookmarks</h1>
        <p>Your saved posts, ready to pick up again.</p>
      </div>
      <div className="library-count"><strong>{page?.collectionTotal.toLocaleString() ?? '—'}</strong><span>{mode === 'live' ? 'imported bookmarks' : 'bookmarks'}</span></div>
    </header>
    <div className="library-controls">
      <label className="library-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search all bookmarks" aria-describedby="library-search-help" placeholder="Search text, authors, or topics…" maxLength={200} value={query} onChange={(event) => { setQuery(event.target.value); if (!event.target.value.trim()) { setSettledQuery(''); setPagination({ key: '', offset: 0 }); } }} /></label>
      <details className="library-filter-options"><summary>Filter & sort{topic || sort !== 'auto' ? ' · active' : ''}</summary><div>
      <label>Topic<select aria-label="Filter bookmarks by topic" value={topic} onChange={(event) => selectTopic(event.target.value)}>
        <option value="">All topics</option><option value="__untagged">Without topics</option>
        {(page?.topics ?? result?.page.topics ?? []).map((item) => <option key={item.id} value={item.id}>{item.label} ({item.count})</option>)}
      </select></label>
      <label>Sort<select aria-label="Sort bookmarks" value={sort} onChange={(event) => { setSort(event.target.value); setPagination({ key: '', offset: 0 }); }}>
        <option value="auto">{query.trim() ? 'Best match' : 'Recently imported (default)'}</option><option value="imported">Recently imported</option><option value="newest">Newest post</option><option value="oldest">Oldest post</option>
      </select></label>
      </div></details>
    </div>
    <div className="library-results-line">
      <p role="status">{stale && page ? loading ? 'Updating results… Previous results shown below.' : 'Previous results shown below.' : loading && !page ? 'Searching your library…' : page ? `${page.total.toLocaleString()} ${filtered ? 'matching' : mode === 'live' ? 'imported' : 'saved'} ${page.total === 1 ? 'bookmark' : 'bookmarks'}${query.trim() && sort === 'auto' ? ' · Best match' : ''}` : 'Your saved material'}</p>
      <div>{newSince > 0 ? <button type="button" aria-pressed={newOnly} onClick={() => { onNewOnlyChange(!newOnly); setPagination({ key: '', offset: 0 }); }}>New this session</button> : null}
        {filtered ? <button type="button" onClick={reset}>Clear filters</button> : null}</div>
    </div>
    {error ? <div className="library-error" role="alert"><p>{error}</p><button type="button" onClick={() => { setFailure(null); setRetry((value) => value + 1); }}>Try again</button></div> : null}
    <div className="library-list" aria-busy={loading}>
      {page?.items.map((item, index) => <BookmarkCard key={item.postId} item={item} index={index} newSince={newSince} query={displayedQuery} onTopic={selectTopic} onExplore={onExplore} />)}
      {!loading && !stale && page?.items.length === 0 ? <div className="library-empty"><span aria-hidden="true">✦</span><h2>{mode === 'shared' ? 'Shared maps keep bookmarks private.' : filtered ? 'No bookmarks match yet.' : 'Your next idea starts with a save.'}</h2><p>{mode === 'shared' ? 'Open your own library to read saved posts.' : filtered ? 'Try a different phrase or clear the filters to see your library.' : 'Connect X and sync to bring your saved material here.'}</p>{filtered ? <button type="button" onClick={reset}>Show all bookmarks</button> : null}</div> : null}
    </div>
    {page?.nextOffset != null ? <button className="library-load-more" type="button" disabled={loading || stale} onClick={() => setPagination({ key, offset: page.nextOffset! })}>{loading ? stale ? 'Updating results…' : 'Loading more…' : `Load more · ${page.items.length} of ${page.total}`}</button> : null}
    <p className="library-footnote" id="library-search-help">{query.trim() ? 'Search finds all your words across text, authors, and topics. Use quotes for an exact phrase.' : mode === 'live' ? 'Search covers your whole imported collection. Dates show when posts were published, not when you saved them.' : 'Demo bookmarks let you try reading, filtering, and exploring before connecting X.'}</p>
  </section>;
}
