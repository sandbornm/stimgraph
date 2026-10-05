'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ExploreIndex } from '@/lib/explore-model';
import { blankResearchCard, parseResearchDraft, researchExcerpt, researchLenses, researchMarkdown, saveIntents, suggestResearchSources,
  type NearbyCheck, type ResearchCard, type ResearchDraft, type ResearchEvidence, type ResearchLens, type ResearchReach, type SaveIntent } from '@/lib/research-model';

type Props = { index: ExploreIndex; anchorId?: string; mode: 'demo' | 'live' | 'shared'; hidden: boolean };
const fields = [
  ['question', 'Research question', 'What specific question could these sources help investigate?', 500],
  ['method', 'Method to try', 'Which method, model, or way of measuring might be useful?', 1500],
  ['problem', 'Problem to investigate', 'Where could it help, and under what conditions?', 1500],
  ['connection', 'Proposed connection', 'Explain the transfer or tension. Keep speculation separate from quotations.', 1500],
  ['firstTest', 'Smallest investigation', 'A toy example, comparison, or observation that could support or weaken this idea.', 1500],
  ['notes', 'My notes', 'What changed your mind? What would you follow next?', 3000],
] as const;

async function researchAction<T>(body: object): Promise<T> {
  const response = await fetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'This research action could not be completed.');
  return data as T;
}

export function ResearchBench({ index, anchorId, mode, hidden }: Props) {
  const posts = useMemo(() => [...index.nodes.values()].filter((node) => node.kind === 'source'), [index]);
  const anchor = index.nodes.get(anchorId ?? '')?.kind === 'source' ? anchorId! : posts[0]?.id ?? '';
  const [reach, setReach] = useState<ResearchReach>('close');
  const [lens, setLens] = useState<ResearchLens>('method_transfer');
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [intents, setIntents] = useState<Record<string, SaveIntent>>({});
  const [filter, setFilter] = useState('');
  const selected = chosen ?? suggestResearchSources(index, anchor, reach);
  const sources = selected.flatMap((id) => {
    const node = index.nodes.get(id);
    return node?.kind === 'source' ? [{ id, label: node.label.slice(0, 500), excerpt: researchExcerpt(node.note || node.label) }] : [];
  });
  const [draft, setDraft] = useState<ResearchDraft | null>(null);
  const [saved, setSaved] = useState<ResearchCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(mode === 'live');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'live' || hidden || !loading) return;
    const controller = new AbortController();
    fetch('/api/research', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Saved research cards could not be loaded.');
      const data = await response.json() as { cards: ResearchCard[] };
      if (!controller.signal.aborted) { setSaved(data.cards); setLoadError(''); }
    }).catch((error: Error) => { if (!controller.signal.aborted) setLoadError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mode, loadAttempt, hidden, loading]);

  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label); setError(''); setMessage('');
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : 'This research action failed. Your draft is still here.'); }
    finally { setBusy(''); }
  };
  const update = (patch: Partial<ResearchDraft>) => setDraft((previous) => previous ? { ...previous, ...patch } : previous);
  const sourceUpdate = (id: string, patch: Partial<ResearchEvidence>) => {
    if (draft) update({ sources: draft.sources.map((source) => source.id === id ? { ...source, ...patch } : source) });
  };
  const start = () => { setDraft(blankResearchCard(sources, intents, lens, reach)); setSelectedCardId(null); setMessage(''); setError(''); };
  const generate = () => run('Drafting with Grok…', async () => {
    const data = await researchAction<{ card: ResearchDraft }>({ action: 'generate', consent: true, sourceIds: sources.map((source) => source.id), intents, lens, reach });
    setDraft(data.card); setSelectedCardId(null);
    setMessage('Grok drafted a candidate. Quotations were checked against the supplied excerpts; review the interpretation and assumptions.');
  });
  const save = () => run('Saving…', async () => {
    const parsed = parseResearchDraft(draft && { ...draft, assumptions: draft.assumptions.map((value) => value.trim()).filter(Boolean), counterexamples: draft.counterexamples.map((value) => value.trim()).filter(Boolean) });
    if (!parsed) throw new Error('Add a question and 2–8 sources. Lists can have up to five entries of 500 characters each.');
    if (saved.length >= 100) throw new Error('Remove a saved card before keeping another.');
    const card = mode === 'live' ? (await researchAction<{ card: ResearchCard }>({ action: 'save', card: parsed })).card
      : { ...parsed, id: crypto.randomUUID(), createdAt: Date.now() };
    setSaved((previous) => [card, ...previous]); setDraft(card); setSelectedCardId(card.id);
    setMessage(mode === 'live' ? 'Saved a private version. Further edits will save as a new card.' : 'Kept for this session. Export the card to keep it after reloading.');
  });
  const nearby = () => run('Searching Crossref…', async () => {
    if (!draft) return;
    const data = await researchAction<{ nearby: NearbyCheck }>({ action: 'nearby', consent: true, query: draft.searchQuery });
    update({ nearby: data.nearby }); setMessage('Search results added to this draft. Read the closest papers and save a version to keep the search record.');
  });
  const remove = (id: string) => run('Removing…', async () => {
    if (mode === 'live') {
      const response = await fetch(`/api/research?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error('Could not remove the card.');
    }
    setSaved((previous) => previous.filter((card) => card.id !== id)); setDeleteId(null);
    if (selectedCardId === id) setSelectedCardId(null);
    setMessage('Saved card removed. The open draft is still available.');
  });
  const download = () => {
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([researchMarkdown(draft)], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'stimgraph-research-card.md'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const canStart = sources.length >= 2 && sources.length <= 8 && sources.length === selected.length;
  const matching = posts.filter((post) => `${post.label} ${post.note}`.toLowerCase().includes(filter.toLowerCase()));

  return <div className="research-bench trajectory-workspace" id="research-bench" hidden={hidden}>
    <aside className="trajectory-library" aria-label="Saved research cards">
      <div className="trajectory-section-title"><h2>Research cards</h2><span>{saved.length} / 100</span></div>
      <p>{mode === 'live' ? 'Private to your connected account.' : 'This session only. Export cards to keep a copy.'}</p>
      {loading && <p>Loading cards…</p>}
      {loadError && <p role="alert">{loadError} <button type="button" onClick={() => { setLoading(true); setLoadAttempt((value) => value + 1); }}>Retry</button></p>}
      {!loading && !loadError && !saved.length && <p>Keep a promising question with its sources and a first investigation.</p>}
      {saved.map((card) => <div className="trajectory-saved" key={card.id}>
        <button type="button" disabled={Boolean(busy)} className={selectedCardId === card.id ? 'selected' : ''} onClick={() => {
          if (draft && !window.confirm('Open this saved version? Export or save any current edits first.')) return;
          setDraft(card); setSelectedCardId(card.id); setError(''); setMessage('Editing a copy. Save to keep a separate version.');
        }}><strong>{card.question}</strong><small>{researchLenses[card.lens]} · {card.sources.length} sources</small></button>
        {deleteId === card.id ? <div className="trajectory-delete"><span>Remove this saved version?</span><button type="button" disabled={Boolean(busy)} onClick={() => void remove(card.id)}>Remove</button><button type="button" onClick={() => setDeleteId(null)}>Cancel</button></div>
          : <button type="button" className="trajectory-remove" disabled={Boolean(busy)} aria-label={`Remove ${card.question}`} onClick={() => setDeleteId(card.id)}>×</button>}
      </div>)}
    </aside>
    <div className="trajectory-draft">
      <div className="trajectory-section-title"><h2>{draft ? 'Develop a research question' : 'What could these bookmarks help you investigate?'}</h2><span>RESEARCH BENCH</span></div>
      <p className="bridge-intro">Choose sources → try a connection → plan a small investigation. Keep the evidence close as the idea takes shape.</p>
      {draft && <button type="button" disabled={Boolean(busy)} onClick={() => {
        if (!window.confirm('Start a new card? Export or save any current edits first.')) return;
        setDraft(null); setSelectedCardId(null); setError(''); setMessage('');
      }}>New card · choose sources</button>}
      <fieldset className="research-form" disabled={Boolean(busy)}>
        <legend className="sr-only">Research card editor</legend>
        {!draft ? <>
          <div className="research-settings trajectory-fields">
            <label>Try this lens<select value={lens} onChange={(event) => setLens(event.target.value as ResearchLens)}>{Object.entries(researchLenses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Explore distance<select value={reach} onChange={(event) => setReach(event.target.value as ResearchReach)}><option value="close">Stay close</option><option value="far">Reach further</option></select></label>
          </div>
          <p className="trajectory-muted">Stay close favors shared bookmark topics. Reach further favors less overlap. Distance suggests a starting set; it does not measure originality.</p>
          <button type="button" disabled={!anchor} onClick={() => setChosen(suggestResearchSources(index, anchor, reach))}>Suggest sources from this part of the map</button>
          <details className="research-picker" open={sources.length < 2}>
            <summary>Choose bookmarks · {selected.length} of 8 selected</summary>
            <label className="research-search">Find a bookmark<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search saved text…" /></label>
            <div className="research-source-options">{matching.map((post) => <label key={post.id}><input type="checkbox" checked={selected.includes(post.id)} disabled={!selected.includes(post.id) && selected.length >= 8} onChange={() => setChosen(selected.includes(post.id) ? selected.filter((id) => id !== post.id) : [...selected, post.id])} /><span>{post.label}</span></label>)}</div>
            {!matching.length && <p className="trajectory-muted">No bookmarks match. Shared maps exclude source text; connect your own collection to use it here.</p>}
          </details>
          {sources.map((source) => <details className="research-source" key={source.id}>
            <summary>{source.label}</summary>
            <p>{source.excerpt}</p>
            <label>Why I saved this<select value={intents[source.id] ?? 'curious'} onChange={(event) => setIntents((previous) => ({ ...previous, [source.id]: event.target.value as SaveIntent }))}>{Object.entries(saveIntents).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          </details>)}
          <div className="trajectory-actions"><button type="button" disabled={!canStart || mode !== 'live'} onClick={() => void generate()}>Draft with Grok</button><button type="button" disabled={!canStart} onClick={start}>Write a card myself</button></div>
          <p className="trajectory-muted">Draft with Grok sends up to eight selected excerpts (800 characters each) and your reasons for saving them to xAI. Links and handles are redacted; prose can still contain identifying details. No X credentials are sent. No search runs with the draft. <a href="https://docs.x.ai/developers/faq/security" target="_blank" rel="noreferrer">xAI retention policy</a>.</p>
          {mode !== 'live' && <p className="trajectory-muted">Grok and Crossref actions require your connected account. Try a manual card with the demo bookmarks.</p>}
        </> : <>
          <p className="research-candidate">Research candidate · {researchLenses[draft.lens]} · {draft.reach === 'close' ? 'Stay close' : 'Reach further'}</p>
          <div className="trajectory-fields">
            {fields.map(([key, label, placeholder, maxLength]) => <label key={key}>{label}<textarea rows={key === 'question' ? 2 : 3} value={draft[key]} maxLength={maxLength} placeholder={placeholder} onChange={(event) => update({ [key]: event.target.value })} /></label>)}
            {(['assumptions', 'counterexamples'] as const).map((key) => <label key={key}>{key === 'assumptions' ? 'Assumptions to check' : 'Counterexamples or failure conditions'}<textarea rows={3} value={draft[key].join('\n')} maxLength={2504} placeholder="One per line; up to five short entries." onChange={(event) => update({ [key]: event.target.value.split('\n') })} /></label>)}
          </div>
          <h3 className="research-subtitle">Source evidence</h3>
          <p className="trajectory-muted">Roles and explanations are interpretations. Quotations must match the source excerpt. A saved post is not an endorsement.</p>
          {draft.sources.map((source) => {
            const node = index.nodes.get(source.id);
            const href = node?.url && /^https?:\/\//.test(node.url) ? node.url : undefined;
            return <details className="research-source" key={source.id} open>
              <summary>{source.label}{!node ? ' · Not in the current map' : ''}</summary>
              <div className="research-settings trajectory-fields">
                <label>Role<select value={source.role} onChange={(event) => sourceUpdate(source.id, { role: event.target.value as ResearchEvidence['role'] })}>{['problem', 'method', 'claim', 'assumption', 'result'].map((role) => <option key={role}>{role}</option>)}</select></label>
                <label>Why I saved this<select value={source.intent} onChange={(event) => sourceUpdate(source.id, { intent: event.target.value as SaveIntent })}>{Object.entries(saveIntents).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              </div>
              <div className="trajectory-fields"><label>Exact quotation<textarea value={source.quote} maxLength={500} rows={2} onChange={(event) => sourceUpdate(source.id, { quote: event.target.value })} /></label><label>How this source helps<textarea value={source.reason} maxLength={500} rows={2} onChange={(event) => sourceUpdate(source.id, { reason: event.target.value })} /></label></div>
              {node && <details className="research-excerpt"><summary>Read source excerpt</summary><p>{researchExcerpt(node.note || node.label)}</p></details>}
              {href && <a href={href} target="_blank" rel="noreferrer">Open original ↗</a>}
            </details>;
          })}
          <section className="research-nearby" aria-label="Nearby work">
            <h3 className="research-subtitle">What has already been tried?</h3>
            <p className="trajectory-muted">Search Crossref bibliographic metadata for nearby work. It covers part of the literature and does not check full papers, all preprints, code, or every prior idea.</p>
            <div className="trajectory-fields"><label>Review the query before sending<input value={draft.searchQuery} maxLength={250} placeholder="Method + problem + related terminology" onChange={(event) => update({ searchQuery: event.target.value })} /></label></div>
            <div className="trajectory-actions"><button type="button" disabled={mode !== 'live' || !draft.searchQuery.trim()} onClick={() => void nearby()}>Search nearby work · Crossref</button></div>
            <p className="trajectory-muted">Only the query above is sent to Crossref. Results suggest papers to read; they do not certify novelty.</p>
            {draft.nearby ? <div className="research-results"><p>Last completed search: “{draft.nearby.query}” · {new Date(draft.nearby.checkedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
              {draft.nearby.query !== draft.searchQuery.trim() && <p>The query has changed. These results are from the earlier query.</p>}
              {draft.nearby.works.length ? <ol>{draft.nearby.works.map((work) => <li key={work.doi}><a href={`https://doi.org/${encodeURIComponent(work.doi)}`} target="_blank" rel="noreferrer">{work.title} ↗</a><small>{work.authors}{work.year ? ` · ${work.year}` : ''}</small></li>)}</ol> : <p>No matching metadata was returned. Try other terminology; this is not evidence that the idea is new.</p>}
            </div> : <p className="trajectory-muted">Not checked yet.</p>}
          </section>
          <div className="trajectory-actions"><button type="button" disabled={loading || Boolean(loadError) || !draft.question.trim()} onClick={() => void save()}>{mode === 'live' ? 'Save private version' : 'Keep for this session'}</button><button type="button" onClick={download}>Export research card .md</button></div>
          <p className="trajectory-muted">Each save keeps a separate version. Cards have no public link. Export includes your notes and selected quotations.</p>
        </>}
      </fieldset>
      <p className="trajectory-status" role="status">{busy || message}</p>
      {error && <p className="research-error" role="alert">{error}</p>}
    </div>
  </div>;
}
