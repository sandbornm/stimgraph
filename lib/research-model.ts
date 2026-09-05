import type { ExploreIndex } from './explore-model.ts';

export const researchLenses = {
  method_transfer: 'Transfer a method', tension: 'Find a tension', shared_problem: 'Find a shared problem',
  constraint_shift: 'Change a constraint', missing_evidence: 'Find missing evidence',
} as const;
export const saveIntents = { curious: 'Caught my attention', method: 'Useful method', question: 'Open question', disagree: 'I disagree', project: 'Possible project' } as const;
export type ResearchLens = keyof typeof researchLenses;
export type SaveIntent = keyof typeof saveIntents;
export type ResearchReach = 'close' | 'far';
export type ResearchSource = { id: string; label: string; excerpt: string };
export type ResearchEvidence = { id: string; label: string; intent: SaveIntent; role: 'problem' | 'method' | 'claim' | 'assumption' | 'result'; quote: string; reason: string };
export type NearbyWork = { doi: string; title: string; year: number | null; authors: string };
export type NearbyCheck = { query: string; checkedAt: number; provider: 'Crossref'; works: NearbyWork[] };
export type ResearchDraft = {
  lens: ResearchLens; reach: ResearchReach; question: string; method: string; problem: string; connection: string;
  assumptions: string[]; counterexamples: string[]; firstTest: string; searchQuery: string;
  sources: ResearchEvidence[]; notes: string; nearby: NearbyCheck | null;
};
export type ResearchCard = ResearchDraft & { id: string; createdAt: number };
export const researchExcerpt = (text: string) => text.replace(/https?:\/\/\S+/g, '[link]').replace(/@[a-z0-9_]+/gi, '[account]').slice(0, 800);
export const normalizeQuote = (text: string) => text.replace(/\s+/g, ' ').trim();

export function suggestResearchSources(index: ExploreIndex, anchor: string, reach: ResearchReach): string[] {
  const topicIds = (id: string) => new Set((index.links.get(id) ?? []).filter(({ node, edge }) => node.kind === 'topic' && edge.kind === 'evidence').map(({ node }) => node.id));
  const anchored = topicIds(anchor);
  const posts = [...index.nodes.values()].filter((node) => node.kind === 'source' && node.id !== anchor);
  const overlap = (id: string) => {
    const topics = topicIds(id);
    const intersection = [...topics].filter((topic) => anchored.has(topic)).length;
    return intersection / Math.max(1, new Set([...anchored, ...topics]).size);
  };
  posts.sort((a, b) => (reach === 'close' ? overlap(b.id) - overlap(a.id) : overlap(a.id) - overlap(b.id)) || a.id.localeCompare(b.id));
  return [anchor, ...posts.slice(0, 3).map((node) => node.id)].filter((id) => index.nodes.get(id)?.kind === 'source');
}

export function blankResearchCard(sources: ResearchSource[], intents: Record<string, SaveIntent>, lens: ResearchLens, reach: ResearchReach): ResearchDraft {
  return { lens, reach, question: '', method: '', problem: '', connection: '', assumptions: [], counterexamples: [], firstTest: '', searchQuery: '',
    sources: sources.map(({ id, label }) => ({ id, label, intent: intents[id] ?? 'curious', role: 'claim', quote: '', reason: '' })), notes: '', nearby: null };
}

const text = (value: unknown, max: number, required = false): value is string => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
const list = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 5 && value.every((item) => text(item, 500, true));

export function parseResearchDraft(value: unknown): ResearchDraft | null {
  if (!value || typeof value !== 'object') return null;
  const d = value as Record<string, unknown>;
  if (!Object.hasOwn(researchLenses, String(d.lens)) || !['close', 'far'].includes(String(d.reach))
    || !text(d.question, 500, true) || !text(d.method, 1500) || !text(d.problem, 1500) || !text(d.connection, 1500)
    || !text(d.firstTest, 1500) || !text(d.searchQuery, 250) || !text(d.notes, 3000) || !list(d.assumptions) || !list(d.counterexamples)
    || !Array.isArray(d.sources) || d.sources.length < 2 || d.sources.length > 8) return null;
  const sources: ResearchEvidence[] = [];
  for (const item of d.sources) {
    if (!item || typeof item !== 'object') return null;
    const s = item as Record<string, unknown>;
    if (!text(s.id, 250, true) || !s.id.startsWith('bookmark:') || sources.some((source) => source.id === s.id)
      || !text(s.label, 500, true) || !text(s.quote, 500) || (s.quote !== '' && !s.quote.trim()) || !text(s.reason, 500)
      || !Object.hasOwn(saveIntents, String(s.intent)) || !['problem', 'method', 'claim', 'assumption', 'result'].includes(String(s.role))) return null;
    sources.push({ id: s.id, label: s.label, quote: s.quote, reason: s.reason, intent: s.intent as SaveIntent, role: s.role as ResearchEvidence['role'] });
  }
  let nearby: NearbyCheck | null = null;
  if (d.nearby !== null) {
    if (!d.nearby || typeof d.nearby !== 'object') return null;
    const n = d.nearby as Record<string, unknown>;
    if (n.provider !== 'Crossref' || !text(n.query, 250, true) || typeof n.checkedAt !== 'number' || !Number.isFinite(n.checkedAt) || n.checkedAt <= 0 || n.checkedAt > 8_640_000_000_000_000
      || !Array.isArray(n.works) || n.works.length > 5) return null;
    const works: NearbyWork[] = [];
    for (const item of n.works) {
      if (!item || typeof item !== 'object') return null;
      const work = item as Record<string, unknown>;
      if (!text(work.doi, 250, true) || !/^10\.\d{4,9}\/\S+$/.test(work.doi) || !text(work.title, 1000, true) || !text(work.authors, 500)
        || (work.year !== null && (typeof work.year !== 'number' || !Number.isInteger(work.year) || work.year < 1000 || work.year > 3000))) return null;
      works.push({ doi: work.doi, title: work.title, authors: work.authors, year: work.year as number | null });
    }
    nearby = { provider: 'Crossref', query: n.query, checkedAt: n.checkedAt, works };
  }
  return { lens: d.lens as ResearchLens, reach: d.reach as ResearchReach, question: d.question.trim(), method: d.method, problem: d.problem, connection: d.connection,
    assumptions: d.assumptions, counterexamples: d.counterexamples, firstTest: d.firstTest, searchQuery: d.searchQuery, notes: d.notes, sources, nearby };
}

export function parseGeneratedResearch(value: unknown, sources: ResearchSource[], intents: Record<string, SaveIntent>, lens: ResearchLens, reach: ResearchReach): ResearchDraft | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.sources)) return null;
  const evidence: ResearchEvidence[] = [];
  for (const raw of data.sources) {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Record<string, unknown>;
    const source = sources.find((_, i) => `s${i + 1}` === item.ref);
    if (!source || !text(item.quote, 500, true) || normalizeQuote(item.quote).length < 8
      || !normalizeQuote(source.excerpt).includes(normalizeQuote(item.quote))) return null;
    evidence.push({ id: source.id, label: source.label, intent: intents[source.id] ?? 'curious', role: item.role as ResearchEvidence['role'], quote: item.quote, reason: item.reason as string });
  }
  return parseResearchDraft({ ...data, lens, reach, sources: evidence, notes: '', nearby: null });
}

export function researchMarkdown(card: ResearchDraft): string {
  const plain = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>#!|]/g, '\\$&');
  return [`# ${plain(card.question)}`, '', `Lens: ${researchLenses[card.lens]} · ${card.reach === 'close' ? 'Stay close' : 'Reach further'}`, '',
    ...[['Method', card.method], ['Problem', card.problem], ['Proposed connection', card.connection], ['Smallest investigation', card.firstTest], ['My notes', card.notes]].flatMap(([label, value]) => [`## ${label}`, '', plain(value) || 'Not recorded.', '']),
    '## Assumptions', '', ...card.assumptions.map((value) => `- ${plain(value)}`), '', '## Counterexamples / failure conditions', '', ...card.counterexamples.map((value) => `- ${plain(value)}`), '',
    '## Source evidence', '', ...card.sources.flatMap((source) => [`- ${plain(source.label)} (${source.role}; ${saveIntents[source.intent]})`, `  Source: ${/^bookmark:\d+$/.test(source.id) ? `https://x.com/i/status/${source.id.slice(9)}` : plain(source.id)}`, `  ${plain(source.quote || 'No excerpt selected.')}`, `  ${plain(source.reason)}`]), '',
    '## Nearby work', '', ...(card.nearby ? [`Crossref metadata query: ${plain(card.nearby.query)}`, `Checked: ${new Date(card.nearby.checkedAt).toISOString()}`, ...card.nearby.works.map((work) => `- ${plain(work.title)} · ${work.year ?? 'Year unavailable'} · https://doi.org/${encodeURIComponent(work.doi)}`)] : ['Not checked.']), '',
    'A research candidate, not a claim of novelty. A Crossref search is limited to its indexed metadata and does not establish that no prior work exists.', '',
  ].join('\n');
}
