'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildExploreIndex, connectionReason, exploreArrowAction, exploreConnections, exploreForwardConnections, explorePreview, exploreStarts, reconcileExploreOrder,
  type ExploreAction, type ExploreNode, type ExploreOrientation, type ExploreTrail,
} from '@/lib/explore-model';
import type { GraphEdge } from '@/lib/graph-model';

type Props = {
  nodes: ExploreNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  trail: ExploreTrail;
  visited: Set<string>;
  mode: 'demo' | 'live' | 'shared';
  theme: 'dark' | 'light';
  onSelect: (id: string, via?: string) => void;
  onTravel: (cursor: number) => void;
  onHome: () => void;
  onInspect: () => void;
  onSearch: () => void;
  onScout: () => void;
  shortcutsBlocked: boolean;
  orientation: ExploreOrientation;
  onOrientationChange: (orientation: ExploreOrientation) => void;
};

const kindLabel = { topic: 'Topic', person: 'Person', source: 'Bookmark', scout: 'Scout find' };
const PAGE_SIZE = 5;

export function ExploreGraph(props: Props) {
  const index = useMemo(() => buildExploreIndex(props.nodes, props.edges), [props.nodes, props.edges]);
  return <ExploreScene key={`${props.mode}:${props.selectedId ?? 'overview'}`} {...props} index={index} />;
}

function ExploreScene({ index, selectedId, trail, visited, mode, theme, onSelect, onTravel, onHome, onInspect, onSearch, onScout, shortcutsBlocked, orientation, onOrientationChange }: Props & {
  index: ReturnType<typeof buildExploreIndex>;
}) {
  const [page, setPage] = useState(0);
  const [startKind, setStartKind] = useState<'topic' | 'source'>(() => exploreStarts(index, 'topic').length ? 'topic' : 'source');
  const [filter, setFilter] = useState('all');
  const [includeScout, setIncludeScout] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [keyboardId, setKeyboardId] = useState<string | null>(null);
  const [branchOrder, setBranchOrder] = useState<string[]>([]);
  const [previewIds, setPreviewIds] = useState<Map<string, string>>(new Map());
  const [initialIds] = useState(() => new Set(index.nodes.keys()));
  const sectionRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const root = selectedId ? index.nodes.get(selectedId) : undefined;
  const trailIds = new Set(trail.steps.slice(0, trail.cursor + 1));
  const connections = root ? exploreForwardConnections(index, root.id, trailIds, includeScout) : [];
  const earlierConnections = root ? exploreConnections(index, root.id, includeScout).length - connections.length : 0;
  const atEnd = Boolean(root) && earlierConnections > 0 && connections.length === 0;
  const nextOptions = root
    ? connections.filter(({ node }) => filter === 'all' || node.kind === filter).map(({ node, edge }) => ({ node, reason: connectionReason(root, node, edge), kind: edge.kind }))
    : exploreStarts(index, startKind).map((node) => ({ node, reason: startKind === 'topic' ? `${exploreConnections(index, node.id).filter(({ node: neighbor }) => neighbor.kind === 'source').length} linked bookmarks` : node.evidence, kind: 'evidence' as const }));
  const orderedIds = reconcileExploreOrder(branchOrder, nextOptions.map(({ node }) => node.id));
  if (orderedIds.length !== branchOrder.length || orderedIds.some((id, position) => id !== branchOrder[position])) {
    setBranchOrder(orderedIds);
  }
  const byOptionId = new Map(nextOptions.map((option) => [option.node.id, option]));
  const options = orderedIds.map((id) => byOptionId.get(id)!);
  const pageCount = Math.max(1, Math.ceil(options.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const branches = options.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const excluded = new Set([...trailIds, ...(root ? [root.id] : []), ...branches.map(({ node }) => node.id)]);
  const rows = branches.map((branch) => {
    const preview = explorePreview(index, branch.node.id, excluded, includeScout, previewIds.get(branch.node.id));
    if (preview) excluded.add(preview.node.id);
    return { ...branch, preview };
  });
  if (rows.some(({ node, preview }) => preview && previewIds.get(node.id) !== preview.node.id)) {
    const nextPreviews = new Map(previewIds);
    rows.forEach(({ node, preview }) => { if (preview) nextPreviews.set(node.id, preview.node.id); });
    setPreviewIds(nextPreviews);
  }
  const lineKey = rows.map(({ node, preview, kind }) => `${node.id}:${preview?.node.id}:${kind}`).join('|');
  const litId = rows.find(({ node }) => node.id === (hovered ?? keyboardId))?.node.id ?? rows[0]?.node.id;
  const activeBranch = rows.find(({ node }) => node.id === litId);
  const newCount = options.filter(({ node }) => !initialIds.has(node.id)).length;
  const availableTrail = trail.steps.map((id, cursor) => ({ node: index.nodes.get(id), cursor }));
  const unseen = exploreStarts(index, 'source').find((node) => !visited.has(node.id) && node.id !== selectedId)
    ?? exploreStarts(index, 'topic').find((node) => !visited.has(node.id) && node.id !== selectedId);

  useEffect(() => {
    if (selectedId && !shortcutsBlocked) headingRef.current?.focus();
  }, [selectedId, shortcutsBlocked]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => boardRef.current?.querySelector('[data-explore-root]')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
    return () => window.cancelAnimationFrame(frame);
  }, [orientation]);

  const navigate = useCallback((action: ExploreAction, focusButton = false) => {
    if (action === 'back') {
      if (trail.cursor > 0) onTravel(trail.cursor - 1);
      else onHome();
      return;
    }
    if (!rows.length) return;
    const position = Math.max(0, rows.findIndex(({ node }) => node.id === litId));
    if (action === 'follow') {
      onSelect(rows[position].node.id);
      return;
    }
    const next = (position + (action === 'next' ? 1 : -1) + rows.length) % rows.length;
    setHovered(null);
    setKeyboardId(rows[next].node.id);
    const button = boardRef.current?.querySelectorAll<HTMLButtonElement>('[data-explore-branch]')[next];
    if (focusButton) button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [litId, onHome, onSelect, onTravel, rows, trail.cursor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (shortcutsBlocked || event.altKey || event.metaKey || event.ctrlKey
        || !(target instanceof HTMLElement)
        || target.matches('input, textarea, select') || target.isContentEditable
        || (target !== document.body && !sectionRef.current?.contains(target))) return;
      const action = exploreArrowAction(orientation, event.key);
      if (!action) return;
      event.preventDefault();
      if (event.repeat && (action === 'back' || action === 'follow')) return;
      const previewId = target.closest<HTMLElement>('[data-explore-preview]')?.dataset.explorePreview;
      const previewRow = previewId ? rows.find(({ preview }) => preview?.node.id === previewId) : undefined;
      if (action === 'follow' && previewRow?.preview) onSelect(previewRow.preview.node.id, previewRow.node.id);
      else navigate(action, true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, onSelect, orientation, rows, shortcutsBlocked]);

  useEffect(() => {
    const board = boardRef.current;
    const canvas = canvasRef.current;
    if (!board || !canvas) return;
    const draw = () => {
      const context = canvas.getContext('2d');
      if (!context) return;
      const rect = board.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      context.scale(dpr, dpr);
      const anchor = board.querySelector<HTMLElement>('[data-explore-root]');
      if (!anchor) return;
      const point = (element: HTMLElement, end: boolean) => {
        const box = element.getBoundingClientRect();
        return orientation === 'LR'
          ? { x: (end ? box.right : box.left) - rect.left, y: box.top + box.height / 2 - rect.top }
          : { x: box.left + box.width / 2 - rect.left, y: (end ? box.bottom : box.top) - rect.top };
      };
      const wire = (from: HTMLElement, to: HTMLElement, lit: boolean, dashed: boolean, faint: boolean) => {
        const a = point(from, true);
        const b = point(to, false);
        context.beginPath();
        context.moveTo(a.x, a.y);
        if (orientation === 'LR') {
          const bend = (b.x - a.x) * .5;
          context.bezierCurveTo(a.x + bend, a.y, b.x - bend, b.y, b.x, b.y);
        } else {
          const bend = (b.y - a.y) * .5;
          context.bezierCurveTo(a.x, a.y + bend, b.x, b.y - bend, b.x, b.y);
        }
        context.strokeStyle = theme === 'light' ? `rgba(55, 103, 96, ${lit ? .9 : faint ? .2 : .35})` : `rgba(167, 213, 197, ${lit ? .9 : faint ? .13 : .3})`;
        context.lineWidth = lit ? 1.8 : 1;
        context.setLineDash(dashed ? [3, 5] : []);
        context.shadowColor = theme === 'dark' && lit ? '#a7d5c5' : 'transparent';
        context.shadowBlur = lit ? 12 : 0;
        context.stroke();
        context.setLineDash([]);
        context.shadowBlur = 0;
      };
      board.querySelectorAll<HTMLElement>('[data-explore-branch]').forEach((branch) => {
        const row = branch.closest('[data-explore-row]');
        const preview = row?.querySelector<HTMLElement>('[data-explore-preview]');
        const lit = litId === branch.dataset.exploreBranch;
        wire(anchor, branch, lit, branch.dataset.edgeKind !== 'evidence', false);
        if (preview) wire(branch, preview, lit, preview.dataset.edgeKind !== 'evidence', true);
      });
    };
    const observer = new ResizeObserver(draw);
    observer.observe(board);
    board.querySelectorAll<HTMLElement>('button, [data-explore-root]').forEach((element) => observer.observe(element));
    draw();
    return () => observer.disconnect();
  }, [litId, lineKey, orientation, theme]);

  const changeFilter = (next: string) => { setFilter(next); setPage(0); };
  const explore = (node: ExploreNode, via?: string) => onSelect(node.id, via);
  return (
    <section className={`explorer orientation-${orientation.toLowerCase()}`} ref={sectionRef} aria-label="Explore your interests">
      <header className="explore-header">
        <div>
          <p className="eyebrow">{mode === 'demo' ? 'DEMO COLLECTION' : mode === 'shared' ? 'SHARED COLLECTION' : 'YOUR COLLECTION'} <span> / </span> FOLLOW YOUR CURIOSITY</p>
          <h1 ref={headingRef} tabIndex={-1} aria-label={root ? `Exploring ${root.label}` : undefined}>{root ? 'Where does this lead?' : 'Something here will take you somewhere.'}</h1>
          <p>{root ? 'Choose a connected idea to go further. Open the reader for saved text and evidence.' : 'Start with an interest or a saved post. Follow a branch, then open the reader when you want the details.'}</p>
        </div>
        <button className="explore-search" type="button" onClick={onSearch}><span>⌕</span> Find a starting point <kbd>/</kbd></button>
      </header>

      <nav className="explore-trail" aria-label="Exploration trail">
        <button type="button" onClick={() => onTravel(trail.cursor - 1)} disabled={!root || trail.cursor <= 0} aria-label="Previous exploration step">←</button>
        <button type="button" onClick={() => onTravel(trail.cursor + 1)} disabled={trail.cursor >= trail.steps.length - 1} aria-label="Next exploration step">→</button>
        <button className={!root ? 'current' : ''} type="button" onClick={onHome}>All interests</button>
        <div className="explore-crumbs">
          {availableTrail.map(({ node, cursor }) => node ? (
            <span key={`${cursor}:${node.id}`}><i aria-hidden="true">/</i><button type="button" title={node.label} aria-current={root && cursor === trail.cursor ? 'step' : undefined} className={root && cursor === trail.cursor ? 'current' : cursor > trail.cursor ? 'ahead' : ''} onClick={() => onTravel(cursor)}>{node.label}</button></span>
          ) : null)}
        </div>
        <span className="explore-visited">{[...visited].filter((id) => index.nodes.has(id)).length} explored this session</span>
      </nav>

      <div className="explore-controls">
        <div className="explore-filters" aria-label={root ? 'Connection types' : 'Starting points'}>
          {root ? [['all', 'All connections'], ['topic', 'Topics'], ['source', 'Bookmarks'], ['person', 'People']].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => changeFilter(value)}>{label}</button>
          )) : (['topic', 'source'] as const).map((kind) => (
            <button key={kind} type="button" aria-pressed={startKind === kind} onClick={() => { setStartKind(kind); setPage(0); }}>{kind === 'topic' ? 'Start with a topic' : 'Start with a bookmark'}</button>
          ))}
        </div>
        {root ? <label className="explore-scout-toggle"><input type="checkbox" checked={includeScout} onChange={(event) => { setIncludeScout(event.target.checked); setPage(0); }} /> Include Scout finds</label> : <span className="explore-hint">Hover to light a path · select to follow it</span>}
      </div>

      <div className="explore-canvas-toolbar">
        <div className="explore-orientation" role="group" aria-label="Graph orientation">
          <span>LAYOUT</span>
          <button type="button" aria-label="Left to right (LR)" aria-pressed={orientation === 'LR'} onClick={() => onOrientationChange('LR')}>→ LR</button>
          <button type="button" aria-label="Top to bottom (TB)" aria-pressed={orientation === 'TB'} onClick={() => onOrientationChange('TB')}>↓ TB</button>
        </div>
        <div className="explore-direction-pad" role="group" aria-label="Explore with arrows">
          {(['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'] as const).map((key) => {
            const action = exploreArrowAction(orientation, key)!;
            const label = { previous: 'Previous branch', next: 'Next branch', follow: 'Follow branch', back: 'Back along trail' }[action];
            return <button className={`pad-${key.slice(5).toLowerCase()}`} key={key} type="button" aria-label={label} title={label} disabled={shortcutsBlocked || (action === 'back' ? !root : action === 'follow' ? !rows.length : rows.length < 2)} onClick={() => navigate(action)}>{({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' })[key]}</button>;
          })}
          <span aria-hidden="true">✧</span>
        </div>
        <div className="explore-current-branch" aria-live="polite"><small>{atEnd ? 'BRANCH COMPLETE' : 'READY TO FOLLOW'}</small><strong>{activeBranch?.node.label ?? (atEnd ? 'Try another branch from your trail.' : 'Choose another starting point.')}</strong></div>
        <button className="explore-center-button" type="button" onClick={() => boardRef.current?.querySelector('[data-explore-root]')?.scrollIntoView({ block: 'nearest', inline: 'center' })}>⊙ Show focus</button>
      </div>
      <p className="explore-key-hint"><kbd>{orientation === 'LR' ? '↑' : '←'}</kbd><kbd>{orientation === 'LR' ? '↓' : '→'}</kbd> choose <span>·</span> <kbd>{orientation === 'LR' ? '→' : '↓'}</kbd> follow <span>·</span> <kbd>{orientation === 'LR' ? '←' : '↑'}</kbd> back <span>·</span> click any card to follow it</p>

      <div className="explore-map-scroll">
        <div className="explore-column-labels"><span>{root ? 'YOU ARE HERE' : 'THE STARTING POINT'}</span><span>{root ? 'CONNECTED TO THIS' : 'CHOOSE A BRANCH'}</span><span>ONE STEP FURTHER</span></div>
        <div className={`explore-board ${litId ? 'has-lit-path' : ''}`} ref={boardRef} style={{ '--branch-count': Math.max(1, rows.length) } as React.CSSProperties}>
          <canvas className="explore-wires" ref={canvasRef} aria-hidden="true" />
          <article className={`explore-root ${root?.kind ?? 'collection'}`} data-explore-root>
            <div className="explore-root-star" aria-hidden="true">✧</div>
            <p className="eyebrow">{root ? kindLabel[root.kind] : 'STUFF THAT INTERESTS ME'}</p>
            <h2>{root?.label ?? 'Your curiosity'}</h2>
            <p className="explore-root-note">{root?.note || 'A few things caught your attention. Follow a thread and find out what they have in common.'}</p>
            {root ? <><span className="explore-root-evidence">{root.evidence}</span><button className="explore-detail-button" type="button" onClick={onInspect}>{root.kind === 'source' ? 'Read this bookmark' : 'See the saved posts behind this'} ↗</button></> : <span className="explore-root-evidence">{index.nodes.size} things to explore</span>}
          </article>
          <div className="explore-branches">
            {rows.map(({ node, reason, kind, preview }) => (
              <div className={`explore-branch-row ${litId === node.id ? 'lit' : ''}`} data-explore-row key={node.id} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(node.id)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(null); }}>
                <button className={`explore-node ${node.kind} ${visited.has(node.id) ? 'visited' : ''}`} type="button" data-explore-branch={node.id} data-edge-kind={kind} onClick={() => explore(node)}>
                  <span className="explore-node-meta"><i />{kindLabel[node.kind]}{!initialIds.has(node.id) ? <b>New</b> : visited.has(node.id) ? <b>Visited</b> : null}</span>
                  <strong>{node.label}</strong><small>{reason}</small><span className="explore-node-arrow" aria-hidden="true">{orientation === 'LR' ? '→' : '↓'}</span>
                </button>
                {preview ? <button className={`explore-node explore-preview ${preview.node.kind}`} data-explore-preview={preview.node.id} data-edge-kind={preview.edge.kind} type="button" onClick={() => explore(preview.node, node.id)}>
                  <span className="explore-node-meta"><i />{kindLabel[preview.node.kind]}{visited.has(preview.node.id) ? <b>Visited</b> : null}</span>
                  <strong>{preview.node.label}</strong><small>{connectionReason(node, preview.node, preview.edge)}</small>
                </button> : <span className="explore-branch-end">{node.kind === 'source' ? 'A saved post worth opening' : 'Follow this branch to explore'}</span>}
              </div>
            ))}
            {!rows.length ? <div className="explore-empty"><h2>{atEnd ? 'End of this branch.' : root ? 'No connections in this view.' : 'No starting points here yet.'}</h2><p>{atEnd ? 'The connected items are already on your trail. Go back to choose another direction, or read this item.' : root ? 'Try another type of connection, search your collection, or start somewhere else.' : startKind === 'topic' ? 'Start with a bookmark, or use Topics to name topics for your saved posts.' : 'Connect X and sync your bookmarks, or explore the topics shared with you.'}</p>{atEnd ? <><button type="button" onClick={() => navigate('back')}>Back to the last step</button><button type="button" onClick={onInspect}>Open the reader</button></> : <button type="button" onClick={onSearch}>Search the collection</button>}</div> : null}
          </div>
        </div>
      </div>

      <div className="explore-map-footer">
        <span aria-live="polite">{options.length ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, options.length)} of ${options.length} ${root ? 'connections' : 'starting points'}` : 'No matching connections'}{newCount ? ` · ${newCount} new` : ''} <i>·</i> Dashed lines = overlap or following</span>
        {pageCount > 1 ? <div><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>← Previous</button><button type="button" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>More {root ? 'connections' : 'starting points'} →</button></div> : null}
      </div>
      {earlierConnections > 0 ? <p className="explore-return-note">{earlierConnections} {earlierConnections === 1 ? 'connection is' : 'connections are'} already on your trail. Use Back to revisit.</p> : null}

      <footer className="explore-next">
        <div><span className="explore-next-mark" aria-hidden="true">✳</span><div><strong>Let a saved thought surprise you.</strong><p>Revisit something you haven’t explored in this session.</p></div><button type="button" disabled={!unseen} onClick={() => { if (unseen) explore(unseen); }}>{unseen ? unseen.kind === 'source' ? 'Rediscover a bookmark' : 'Explore another topic' : 'You’ve explored this collection'} ↗</button></div>
        <div><span className="explore-next-mark scout" aria-hidden="true">◇</span><div><strong>Curious what’s beyond your saves?</strong><p>Scout finds are suggestions from X, labeled separately.</p></div><button type="button" onClick={onScout}>Open Scout ↗</button></div>
      </footer>
    </section>
  );
}
