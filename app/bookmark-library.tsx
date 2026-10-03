'use client';

import { useEffect, useMemo, useState } from 'react';
import { filterDemoLibrary, parseLibraryQuery, type LibraryBookmark, type LibraryPage } from '@/lib/bookmark-library';

function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

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
  const [topic, setTopic] = useState('');
  const [sort, setSort] = useState('imported');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; offset: number; page: LibraryPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; offset: number; message: string } | null>(null);
  const params = useMemo(() => new URLSearchParams({ q: query, topic, sort, since: String(newOnly ? newSince : 0) }), [query, topic, sort, newOnly, newSince]);
  const key = `${params.toString()}:${revision}`;
  // A changed collection starts at the first page, even if the reader was further down.
  const effectiveOffset = result && result.key === key ? offset : 0;
  const local = useMemo(() => {
    const options = parseLibraryQuery(params);
    let page = filterDemoLibrary(demoItems, options);
    while (page.nextOffset != null && page.nextOffset <= offset) {
      const next = filterDemoLibrary(demoItems, { ...options, offset: page.nextOffset });
      page = { ...next, items: [...page.items, ...next.items] };
    }
    return page;
  }, [demoItems, params, offset]);
  const page = mode === 'live' ? result?.key === key ? result.page : null : local;
  const error = failure?.key === key && failure.offset === effectiveOffset ? failure.message : '';
  const loading = mode === 'live' && !error && (!result || result.key !== key || result.offset !== effectiveOffset);

  useEffect(() => {
    if (mode !== 'live' || hidden) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const search = new URLSearchParams(params);
        search.set('offset', String(effectiveOffset));
        const response = await fetch(`/api/bookmarks?${search}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? 'Your X connection needs attention. Reconnect X to open your library.' : 'Could not load bookmarks. Try again.');
        const data = await response.json() as LibraryPage;
        if (controller.signal.aborted) return;
        setFailure(null);
        setResult((previous) => ({
          key, offset: effectiveOffset,
          page: { ...data, items: effectiveOffset > 0 && previous?.key === key
            ? [...new Map([...previous.page.items, ...data.items].map((item) => [item.postId, item])).values()]
            : data.items },
        }));
        setOffset(effectiveOffset);
      } catch (error) {
        if (!controller.signal.aborted) setFailure({ key, offset: effectiveOffset, message: error instanceof Error ? error.message : 'Could not load bookmarks.' });
      }
    }, params.get('q') ? 220 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [mode, params, key, effectiveOffset, retry, hidden]);

  const reset = () => { setQuery(''); setTopic(''); onNewOnlyChange(false); setOffset(0); };
  const filtered = Boolean(query || topic || newOnly);

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
      <label className="library-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search all bookmarks" placeholder="Search text, authors, or topics…" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} /></label>
      <details className="library-filter-options"><summary>Filter & sort{topic || sort !== 'imported' ? ' · active' : ''}</summary><div>
      <label>Topic<select aria-label="Filter bookmarks by topic" value={topic} onChange={(event) => { setTopic(event.target.value); setOffset(0); }}>
        <option value="">All topics</option><option value="__untagged">Without topics</option>
        {(page?.topics ?? result?.page.topics ?? []).map((item) => <option key={item.id} value={item.id}>{item.label} ({item.count})</option>)}
      </select></label>
      <label>Sort<select aria-label="Sort bookmarks" value={sort} onChange={(event) => { setSort(event.target.value); setOffset(0); }}>
        <option value="imported">Recently imported</option><option value="newest">Newest post</option><option value="oldest">Oldest post</option>
      </select></label>
      </div></details>
    </div>
    <div className="library-results-line">
      <p role="status">{loading && !page ? 'Searching your library…' : page ? `${page.total.toLocaleString()} ${filtered ? 'matching' : mode === 'live' ? 'imported' : 'saved'} ${page.total === 1 ? 'bookmark' : 'bookmarks'}` : 'Your saved material'}</p>
      <div>{newSince > 0 ? <button type="button" aria-pressed={newOnly} onClick={() => { onNewOnlyChange(!newOnly); setOffset(0); }}>New this session</button> : null}
        {filtered ? <button type="button" onClick={reset}>Clear filters</button> : null}</div>
    </div>
    {error ? <div className="library-error" role="alert"><p>{error}</p><button type="button" onClick={() => { setFailure(null); setRetry((value) => value + 1); }}>Try again</button></div> : null}
    <div className="library-list" aria-busy={loading}>
      {page?.items.map((item, index) => <article className="library-card" key={item.postId}>
        <div className="library-card-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
        <div className="library-card-content">
          <div className="library-meta"><strong>{item.authorName}</strong><span>@{item.authorUsername}</span>{dateLabel(item.createdAt) ? <time dateTime={item.createdAt!}>Posted {dateLabel(item.createdAt)}</time> : null}{newSince > 0 && item.importedAt >= newSince ? <b className="library-new">NEW</b> : null}</div>
          <details className="library-reading"><summary><span>{item.text.replace(/\s+/g, ' ').slice(0, 210)}{item.text.length > 210 ? '…' : ''}</span><small>Read saved post</small></summary><p>{item.text}</p></details>
          <div className="library-card-footer"><div className="library-topics">{item.topics.length ? item.topics.map((itemTopic) => <button type="button" key={itemTopic.id} onClick={() => { setTopic(itemTopic.id); setOffset(0); }}>{itemTopic.label}</button>) : <span>No topics yet</span>}</div>
            <div className="library-card-actions"><a href={`https://x.com/${encodeURIComponent(item.authorUsername)}/status/${encodeURIComponent(item.postId)}`} target="_blank" rel="noreferrer">Original ↗</a><button type="button" onClick={() => onExplore(item)}>Explore connections <span aria-hidden="true">→</span></button></div>
          </div>
        </div>
      </article>)}
      {page?.items.length === 0 ? <div className="library-empty"><span aria-hidden="true">✦</span><h2>{mode === 'shared' ? 'Shared maps keep bookmarks private.' : filtered ? 'No bookmarks match yet.' : 'Your next idea starts with a save.'}</h2><p>{mode === 'shared' ? 'Open your own library to read saved posts.' : filtered ? 'Try a different phrase or clear the filters to see your library.' : 'Connect X and sync to bring your saved material here.'}</p>{filtered ? <button type="button" onClick={reset}>Show all bookmarks</button> : null}</div> : null}
    </div>
    {page?.nextOffset != null ? <button className="library-load-more" type="button" disabled={loading} onClick={() => setOffset(page.nextOffset!)}>{loading ? 'Loading more…' : `Load more · ${page.items.length} of ${page.total}`}</button> : null}
    <p className="library-footnote">{mode === 'live' ? 'Search covers your whole imported collection. Dates show when posts were published, not when you saved them.' : 'Demo bookmarks let you try reading, filtering, and exploring before connecting X.'}</p>
  </section>;
}
