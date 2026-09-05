'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildExploreIndex, visitExploreTrail, type ExploreNode, type ExploreTrail } from '@/lib/explore-model';
import type { GraphEdge } from '@/lib/graph-model';
import { captureTrajectory, resumeTrajectory, trajectoryFrontier, trajectoryMarkdown, trajectoryName, type ConceptTrajectory } from '@/lib/trajectory-model';
import { ConceptBridges } from './concept-bridges';
import { ResearchBench } from './research-bench';

type Props = {
  nodes: ExploreNode[];
  edges: GraphEdge[];
  trail: ExploreTrail;
  visited: Set<string>;
  mode: 'demo' | 'live' | 'shared';
  hidden: boolean;
  onResume: (trail: ExploreTrail) => void;
};
const kindName = { topic: 'Concept', source: 'Saved post', person: 'Person', scout: 'Scout suggestion' };

export function TrajectoryWorkbench({ nodes, edges, trail, visited, mode, hidden, onResume }: Props) {
  const index = useMemo(() => buildExploreIndex(nodes, edges), [nodes, edges]);
  const currentSteps = useMemo(() => captureTrajectory(index, trail), [index, trail]);
  const [open, setOpen] = useState(false);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saved, setSaved] = useState<ConceptTrajectory[]>([]);
  const [selected, setSelected] = useState<ConceptTrajectory | null>(null);
  const [name, setName] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(mode === 'live');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const steps = selected?.steps ?? currentSteps;
  const frontier = useMemo(() => trajectoryFrontier(index, steps, visited), [index, steps, visited]);
  const title = selected?.name ?? (name.trim() || trajectoryName(currentSteps));
  const draft = { name: title, question: selected?.question ?? question, steps };
  const concepts = steps.filter((step) => step.kind === 'topic');

  useEffect(() => {
    if (mode !== 'live') return;
    const controller = new AbortController();
    fetch('/api/trajectories', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Your saved trajectories could not be loaded.');
        const data = await response.json() as { trajectories: ConceptTrajectory[] };
        if (!controller.signal.aborted) { setSaved(data.trajectories); setLoadError(''); }
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setLoadError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadAttempt, mode]);

  const save = async () => {
    if (busy || loading || currentSteps.length < 2 || selected) return;
    setBusy(true);
    setMessage('');
    try {
      let trajectory: ConceptTrajectory;
      const payload = { name: name.trim() || trajectoryName(currentSteps), question, steps: currentSteps };
      if (mode === 'live') {
        const response = await fetch('/api/trajectories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await response.json() as { trajectory: ConceptTrajectory; error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not save this trajectory.');
        trajectory = data.trajectory;
      } else {
        if (saved.length >= 100) throw new Error('Remove a trajectory before keeping another.');
        trajectory = { ...payload, id: crypto.randomUUID(), createdAt: Date.now() };
      }
      setSaved((previous) => [trajectory, ...previous]);
      setSelected(trajectory);
      setLibraryOpen(true);
      setMessage(mode === 'live' ? 'Saved privately to your connected account.' : 'Kept for this session. Export the outline to keep it after a reload.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save this trajectory.'); }
    finally { setBusy(false); }
  };

  const resume = (cursor: number, branchId?: string) => {
    const next = resumeTrajectory(index, steps, cursor);
    if (next.cursor < 0) return;
    onResume(branchId ? visitExploreTrail(next, [branchId]) : next);
    if (selected) { setName(selected.name); setQuestion(selected.question); }
    setSelected(null);
    setMessage(next.steps.length < cursor + 1
      ? 'Resumed the connected part of this path. Earlier missing connections stay in the saved outline.'
      : 'Continue exploring. Save again to keep a new version; the saved trajectory stays intact.');
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      if (mode === 'live') {
        const response = await fetch(`/api/trajectories?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) throw new Error('Could not remove this trajectory.');
      }
      setSaved((previous) => previous.filter((item) => item.id !== id));
      if (selected?.id === id) setSelected(null);
      setDeleteId(null);
      setMessage('Trajectory removed. Your bookmarks are unchanged.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not remove this trajectory.'); }
    finally { setBusy(false); }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([trajectoryMarkdown(draft)], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 70) || 'trajectory'}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="trajectory" hidden={hidden} aria-label="Concept trajectory">
      <div className="trajectory-bar">
        <div><span className="eyebrow">CONCEPT TRAJECTORY</span><p>{currentSteps.length > 1 ? `${currentSteps.length} steps · ${trajectoryName(currentSteps)}` : 'Keep the path when your curiosity finds a direction.'}</p></div>
        <button type="button" aria-expanded={bridgeOpen} onClick={() => { setBridgeOpen(!bridgeOpen); setOpen(false); setResearchOpen(false); }}>Bridge A → B</button>
        <button type="button" aria-expanded={researchOpen} aria-controls="research-bench" onClick={() => { setResearchOpen(!researchOpen); setOpen(false); setBridgeOpen(false); }}>Research bench</button>
        <button type="button" aria-expanded={open} aria-controls="trajectory-workspace" onClick={() => { setOpen(!open); setBridgeOpen(false); setResearchOpen(false); setSelected(null); }}>{open ? 'Close outline' : 'Shape this path'} <span aria-hidden="true">↗</span></button>
        <button type="button" aria-expanded={open && libraryOpen} onClick={() => { setOpen(true); setBridgeOpen(false); setResearchOpen(false); setLibraryOpen(!libraryOpen || !open); }}>Saved trajectories <span>{saved.length}</span></button>
      </div>
      <ResearchBench index={index} anchorId={trail.steps.slice(0, trail.cursor + 1).findLast((id) => index.nodes.get(id)?.kind === 'source')} mode={mode} hidden={!researchOpen} />
      {bridgeOpen && <ConceptBridges index={index} selectedId={trail.steps[trail.cursor]} mode={mode} onUse={(route, question) => {
        const next = { steps: route.nodeIds, cursor: route.nodeIds.length - 1 };
        onResume(next);
        setName(trajectoryName(captureTrajectory(index, next)));
        setQuestion(question);
        setSelected(null);
        setOpen(true);
        setBridgeOpen(false);
        setMessage('This bridge is on your canvas. Add your notes and save it as a trajectory.');
      }} />}
      {open && <div className="trajectory-workspace" id="trajectory-workspace">
        {libraryOpen && <aside className="trajectory-library" aria-label="Saved trajectories">
          <div className="trajectory-section-title"><h2>Saved trajectories</h2><button type="button" onClick={() => { setSelected(null); setMessage(''); }}>Current path</button></div>
          {loading && <p>Loading your trajectories…</p>}
          {loadError && <p role="alert">{loadError} <button type="button" onClick={() => { setLoading(true); setLoadAttempt((value) => value + 1); }}>Retry</button></p>}
          {!loading && !loadError && !saved.length && <p>Name a path and keep it here. Reopen it later to explore another branch.</p>}
          {saved.map((item) => <div className="trajectory-saved" key={item.id}>
            <button className={selected?.id === item.id ? 'selected' : ''} type="button" onClick={() => { setSelected(item); setMessage(''); setDeleteId(null); }}><strong>{item.name}</strong><small>{item.steps.length} steps{mode === 'live' ? ' · Private' : ' · This session'}</small></button>
            {deleteId === item.id ? <div className="trajectory-delete"><span>Remove this saved path?</span><button type="button" disabled={busy} onClick={() => void remove(item.id)}>Remove</button><button type="button" disabled={busy} onClick={() => setDeleteId(null)}>Cancel</button></div>
              : <button type="button" disabled={busy} className="trajectory-remove" aria-label={`Remove ${item.name}`} onClick={() => setDeleteId(item.id)}>×</button>}
          </div>)}
        </aside>}
        <div className="trajectory-draft">
          <div className="trajectory-section-title"><h2>{selected ? selected.name : 'What are you trying to understand?'}</h2><span>{selected ? 'SAVED OUTLINE' : 'CURRENT PATH'}</span></div>
          {selected ? <p className="trajectory-question">{selected.question || 'No question or notes added yet. Resume this path to add them to a new version.'}</p> : <div className="trajectory-fields">
            <label>Name this trajectory<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder={trajectoryName(currentSteps)} /></label>
            <label>Question or notes<textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} rows={2} placeholder="What connects these ideas? What would you like to understand next?" /></label>
          </div>}
          {concepts.length > 1 && <p className="trajectory-concepts"><span>Concepts along this path</span>{concepts.map((step) => step.label).join(' → ')}</p>}
          {steps.length === 0 ? <p className="trajectory-muted">Choose a starting point below and follow a connection. Your route will appear here.</p> : <ol className="trajectory-steps">
            {steps.map((step, cursor) => {
              const exists = index.nodes.has(step.id);
              const connected = cursor === 0 || index.links.get(steps[cursor - 1].id)?.some((link) => link.node.id === step.id);
              return <li key={step.id} className={`${step.kind}${!exists ? ' unavailable' : ''}`}>
                {cursor > 0 && <small>{!step.via ? 'New starting point · no recorded connection' : !connected ? 'Connection no longer in this map' : step.via.reason}</small>}
                <button type="button" disabled={!exists || busy} onClick={() => resume(cursor)} title={exists ? 'Explore from this step' : 'This item is not in the current map'}><span className="trajectory-step-number">{cursor + 1}</span><span><strong>{step.label}</strong><small>{kindName[step.kind]}{!exists ? ' · Not in the current map' : ''}</small></span><span aria-hidden="true">↗</span></button>
              </li>;
            })}
          </ol>}
          <div className="trajectory-actions">
            {selected ? <button type="button" disabled={busy || !index.nodes.has(steps.at(-1)?.id ?? '')} onClick={() => resume(steps.length - 1)}>Resume & branch →</button>
              : <button type="button" disabled={busy || loading || steps.length < 2} onClick={() => void save()}>{busy ? 'Saving…' : mode === 'live' ? 'Save trajectory' : 'Keep for this session'}</button>}
            <button type="button" disabled={steps.length < 2} onClick={download}>Export outline .md</button>
          </div>
          <p className="trajectory-muted">{mode === 'live' ? 'Saved to your account. Trajectories have no public link.' : 'Demo and shared paths last for this session. Export an outline to keep a copy.'} Each save keeps a separate version.</p>
          <p className="trajectory-status" role="status">{message}</p>
          {frontier.length > 0 && <div className="trajectory-frontier">
            <div className="trajectory-section-title"><h3>Still worth a look</h3><span>{frontier.length} UNVISITED SAVED POSTS</span></div>
            <p>Branches beside this path you haven’t visited this session.</p>
            {frontier.slice(0, 3).map(({ node, from, cursor }) => <button key={node.id} disabled={busy} type="button" onClick={() => resume(cursor, node.id)}><strong>{node.label}</strong><small>Branch from {from.label} →</small></button>)}
          </div>}
        </div>
      </div>}
    </section>
  );
}
