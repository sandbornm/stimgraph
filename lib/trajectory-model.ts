import { connectionReason, type ExploreIndex, type ExploreNode, type ExploreTrail } from './explore-model.ts';
import type { GraphEdge } from './graph-model.ts';

export type TrajectoryStep = {
  id: string;
  label: string;
  kind: ExploreNode['kind'];
  via: { kind: GraphEdge['kind']; reason: string } | null;
};
export type ConceptTrajectory = {
  id: string;
  name: string;
  question: string;
  steps: TrajectoryStep[];
  createdAt: number;
};
export type TrajectoryDraft = Pick<ConceptTrajectory, 'name' | 'question' | 'steps'>;

export function captureTrajectory(index: ExploreIndex, trail: ExploreTrail): TrajectoryStep[] {
  return trail.steps.slice(0, trail.cursor + 1).flatMap((id, position, ids) => {
    const node = index.nodes.get(id);
    if (!node) return [];
    const previous = index.nodes.get(ids[position - 1]);
    const edge = previous && index.links.get(previous.id)?.find((link) => link.node.id === id)?.edge;
    return [{ id, label: node.label, kind: node.kind, via: previous && edge ? { kind: edge.kind, reason: connectionReason(previous, node, edge) } : null }];
  });
}

export function trajectoryName(steps: TrajectoryStep[]): string {
  const concepts = steps.filter((step) => step.kind === 'topic');
  const stops = concepts.length > 1 ? concepts : steps;
  const start = stops[0]?.label ?? 'New trajectory';
  const end = stops.at(-1)?.label;
  return (stops.length > 1 ? `${start.slice(0, 52)} → ${end?.slice(0, 52)}` : start).slice(0, 120);
}

/** Resume only the connected portion ending at the chosen step. */
export function resumeTrajectory(index: ExploreIndex, steps: TrajectoryStep[], cursor: number): ExploreTrail {
  if (!index.nodes.has(steps[cursor]?.id)) return { steps: [], cursor: -1 };
  let start = cursor;
  while (start > 0 && steps[start].via && index.nodes.has(steps[start - 1].id)
    && index.links.get(steps[start - 1].id)?.some((link) => link.node.id === steps[start].id)) start -= 1;
  const ids = steps.slice(start, cursor + 1).map((step) => step.id);
  return { steps: ids, cursor: ids.length - 1 };
}

export function trajectoryFrontier(index: ExploreIndex, steps: TrajectoryStep[], visited: Set<string>) {
  const pathIds = new Set(steps.map((step) => step.id));
  const byBookmark = new Map<string, { node: ExploreNode; from: TrajectoryStep; cursor: number }>();
  // Prefer branches near the current end, and count each saved post only once.
  for (let cursor = steps.length - 1; cursor >= 0; cursor -= 1) {
    const from = steps[cursor];
    for (const { node, edge } of index.links.get(from.id) ?? []) {
      if (node.kind !== 'source' || edge.kind !== 'evidence' || pathIds.has(node.id) || visited.has(node.id) || byBookmark.has(node.id)) continue;
      byBookmark.set(node.id, { node, from, cursor });
    }
  }
  return [...byBookmark.values()];
}

export function parseTrajectoryDraft(value: unknown): TrajectoryDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Record<string, unknown>;
  if (typeof draft.name !== 'string' || !draft.name.trim() || draft.name.length > 120
    || typeof draft.question !== 'string' || draft.question.length > 2000
    || !Array.isArray(draft.steps) || draft.steps.length < 2 || draft.steps.length > 80) return null;
  const steps: TrajectoryStep[] = [];
  const ids = new Set<string>();
  for (const raw of draft.steps) {
    if (!raw || typeof raw !== 'object') return null;
    const step = raw as Record<string, unknown>;
    if (typeof step.id !== 'string' || !step.id || step.id.length > 250 || ids.has(step.id)
      || typeof step.label !== 'string' || !step.label || step.label.length > 500
      || !['topic', 'person', 'source', 'scout'].includes(String(step.kind))) return null;
    let via: TrajectoryStep['via'] = null;
    if (step.via !== null) {
      if (!step.via || typeof step.via !== 'object') return null;
      const link = step.via as Record<string, unknown>;
      if (!['evidence', 'affinity', 'follows'].includes(String(link.kind))
        || typeof link.reason !== 'string' || !link.reason || link.reason.length > 200) return null;
      via = { kind: link.kind as GraphEdge['kind'], reason: link.reason };
    }
    if (steps.length === 0 && via !== null) return null;
    ids.add(step.id);
    steps.push({ id: step.id, label: step.label, kind: step.kind as ExploreNode['kind'], via });
  }
  return { name: draft.name.trim(), question: draft.question.trim(), steps };
}

export function trajectoryMarkdown(draft: TrajectoryDraft): string {
  const plain = (value: string) => value.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>#!|]/g, '\\$&');
  return [
    `# ${plain(draft.name)}`, '',
    ...(draft.question ? [`Question / notes: ${plain(draft.question)}`, ''] : []),
    ...draft.steps.flatMap((step, position) => [
      `${position + 1}. ${plain(step.label)} (${step.kind === 'source' ? 'bookmark' : step.kind})`,
      ...(position > 0 ? [`   ${plain(step.via?.reason ?? 'New starting point; no recorded connection.')}`] : []),
    ]), '',
    'Saved with Stimgraph. Relationships describe the graph when captured; they are not prerequisites or claims of mastery.',
    'This export contains route labels and your notes, without full saved-post text.', '',
  ].join('\n');
}
