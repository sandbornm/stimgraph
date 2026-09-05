'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { bridgeIsAvailable, findConceptBridges, type BridgeInterpretation, type ConceptBridge } from '@/lib/bridge-model';
import type { ExploreIndex } from '@/lib/explore-model';

type Props = {
  index: ExploreIndex;
  selectedId?: string;
  mode: 'demo' | 'live' | 'shared';
  onUse: (route: ConceptBridge, question: string) => void;
};

export function ConceptBridges({ index, selectedId, mode, onUse }: Props) {
  const topics = [...index.nodes.values()].filter((node) => node.kind === 'topic').sort((a, b) => a.label.localeCompare(b.label));
  const [fromId, setFromId] = useState(index.nodes.get(selectedId ?? '')?.kind === 'topic' ? selectedId! : topics[0]?.id ?? '');
  const [toId, setToId] = useState('');
  const from = topics.some((node) => node.id === fromId) ? fromId : '';
  const to = topics.some((node) => node.id === toId) ? toId : '';
  const topologyKey = useMemo(() => [...index.nodes.keys()].sort().join('|') + [...index.links].flatMap(([id, links]) => links.map(({ node, edge }) => `${id}:${node.id}:${edge.kind}`)).sort().join('|'), [index]);
  return <section className="concept-bridges" aria-label="Concept bridges">
    <div className="trajectory-section-title"><h2>What connects these concepts?</h2><span>A → B</span></div>
    <p className="bridge-intro">Choose two ideas. See the saved posts between them, then ask Grok to help make sense of the route.</p>
    <div className="bridge-endpoints">
      <label>Concept A<select value={from} onChange={(event) => setFromId(event.target.value)}><option value="">Choose a concept</option>{topics.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select></label>
      <button type="button" aria-label="Swap concepts A and B" disabled={!from || !to} onClick={() => { setFromId(to); setToId(from); }}>⇄</button>
      <label>Concept B<select value={to} onChange={(event) => setToId(event.target.value)}><option value="">Choose a destination</option>{topics.map((node) => <option key={node.id} value={node.id} disabled={node.id === from}>{node.label}</option>)}</select></label>
    </div>
    {topics.length < 2 ? <p className="trajectory-muted">This map needs at least two topics. Add bookmarks or analyze their topics first.</p>
      : from && to && from !== to ? <BridgeResults key={`${from}|${to}|${topologyKey}`} index={index} from={from} to={to} mode={mode} onUse={onUse} />
        : <p className="trajectory-muted">Choose two different concepts to find a bridge.</p>}
  </section>;
}

function BridgeResults({ index, from, to, mode, onUse }: Pick<Props, 'index' | 'mode' | 'onUse'> & { from: string; to: string }) {
  const routes = useMemo(() => findConceptBridges(index, from, to), [index, from, to]);
  const [routeId, setRouteId] = useState(routes[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [advice, setAdvice] = useState<BridgeInterpretation | null>(null);
  const [zeroRetention, setZeroRetention] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const route = routes.find((candidate) => candidate.id === routeId) ?? routes[0];
  const routeAdvice = advice?.routeId === route?.id ? advice : null;
  useEffect(() => () => controllerRef.current?.abort(), []);

  const askGrok = async () => {
    if (busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true); setError('');
    try {
      const visibleIds = [...index.nodes.values()].filter((node) => node.kind === 'topic' || node.kind === 'source').map((node) => node.id);
      const response = await fetch('/api/bridges', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ from, to, visibleIds, consent: true }),
      });
      const data = await response.json() as { interpretation: BridgeInterpretation; routes: ConceptBridge[]; zeroDataRetention: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || 'Grok could not complete this bridge.');
      if (controller.signal.aborted) return;
      const chosen = data.routes.find((item) => item.id === data.interpretation.routeId);
      if (chosen && (!bridgeIsAvailable(index, chosen) || !routes.some((item) => item.id === chosen.id))) throw new Error('Your collection changed. Refresh the map before using this route.');
      if (routes.length && !chosen) throw new Error('The saved connections have changed. Refresh the map and try again.');
      setAdvice(data.interpretation); setZeroRetention(data.zeroDataRetention);
      if (chosen) setRouteId(chosen.id);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Grok could not complete this bridge.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return <div className="bridge-results">
    {routes.length ? <>
      <div className="bridge-route-picker" aria-label="Routes through saved posts">{routes.map((candidate, position) => <button key={candidate.id} type="button" aria-pressed={candidate.id === route.id} onClick={() => setRouteId(candidate.id)}>Route {position + 1} · {candidate.hops.length} {candidate.hops.length === 1 ? 'bridge' : 'bridges'}{advice?.routeId === candidate.id ? ' · Grok’s pick' : ''}</button>)}</div>
      <p className="trajectory-concepts"><span>Connected through your saved posts</span>{route.conceptIds.map((id) => index.nodes.get(id)?.label).join(' → ')}</p>
      <ol className="bridge-hops">{route.hops.map((hop, position) => <li key={`${hop.from}:${hop.to}`}>
        <h3><span>{position + 1}</span>{index.nodes.get(hop.from)?.label} <span aria-hidden="true">→</span> {index.nodes.get(hop.to)?.label}</h3>
        <p className="bridge-evidence-label">{hop.bookmarkIds.length} saved {hop.bookmarkIds.length === 1 ? 'post has' : 'posts have'} both topic labels</p>
        {hop.bookmarkIds.slice(0, 2).map((id) => {
          const post = index.nodes.get(id)!;
          return <details className="bridge-evidence" key={id}><summary>{post.label}</summary><p>{post.note}</p>{post.url && <a href={post.url} target="_blank" rel="noreferrer">Open original saved post ↗</a>}</details>;
        })}
        {routeAdvice?.hops[position] && <p className="bridge-interpretation"><span>Grok’s interpretation</span>{routeAdvice.hops[position].explanation}</p>}
      </li>)}</ol>
      <button className="bridge-use" type="button" onClick={() => onUse(route, routeAdvice?.nextQuestion ?? `What connects ${index.nodes.get(from)?.label} and ${index.nodes.get(to)?.label}?`)}>Open as a trajectory →</button>
    </> : <div className="bridge-no-route"><h3>No saved route connects these yet.</h3><p>We checked the loaded map for routes of up to six concept bridges, each supported by a shared bookmark. More imported or labeled posts may reveal a route.</p></div>}
    <div className="bridge-grok">
      <div><h3>{routes.length ? 'Why might this route be useful?' : 'Ask for a possible direction'}</h3><p>{routes.length ? 'Grok can choose a route and explain its steps using the supporting excerpts.' : 'Grok can suggest intermediate concepts to investigate. These will be unverified suggestions, separate from your map.'}</p></div>
      <button type="button" disabled={mode !== 'live' || busy} onClick={() => void askGrok()}>{busy ? 'Grok is reading the bridge…' : advice ? 'Ask Grok again' : 'Ask Grok'}</button>
      <p className="bridge-consent">This sends concept labels and up to 24 short saved-post excerpts to xAI. X login credentials are excluded. <a href="https://docs.x.ai/developers/faq/security" target="_blank" rel="noreferrer">xAI data handling ↗</a>{mode !== 'live' ? ' Connect your own X collection to use Grok.' : ' Limit: 12 requests per day.'}</p>
      {error && <p className="bridge-error" role="alert">{error}</p>}
      {advice && <div className="bridge-advice" role="status">
        <span className="eyebrow">{advice.routeId ? 'GROK’S ROUTE EXPLANATION' : 'UNVERIFIED RESEARCH DIRECTION'}</span>
        <p>{advice.explanation}</p>
        {!advice.routeId && advice.suggestedConcepts.length > 0 && <p className="bridge-suggestion">{[index.nodes.get(from)?.label, ...advice.suggestedConcepts, index.nodes.get(to)?.label].join(' ⇢ ')}</p>}
        {!advice.routeId && <p className="trajectory-muted">These proposed links have not been found in your bookmarks and have not been added to the graph.</p>}
        <p><strong>Next question</strong><br />{advice.nextQuestion}</p>
        {zeroRetention && <small>xAI reported zero data retention for this response.</small>}
      </div>}
    </div>
  </div>;
}
