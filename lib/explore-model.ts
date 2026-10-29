import type { GraphEdge } from './graph-model.ts';

export type ExploreNode = {
  id: string;
  label: string;
  kind: 'topic' | 'person' | 'source' | 'scout';
  note: string;
  evidence: string;
  size: number;
  url?: string;
  self?: boolean;
};

export type ExploreLink = { node: ExploreNode; edge: GraphEdge };
export type ExploreIndex = {
  nodes: Map<string, ExploreNode>;
  links: Map<string, ExploreLink[]>;
};
export type ExploreTrail = { steps: string[]; cursor: number };
export type ExploreOrientation = 'LR' | 'TB';
export type ExploreAction = 'previous' | 'next' | 'follow' | 'back';

export function exploreArrowAction(orientation: ExploreOrientation, key: string): ExploreAction | null {
  const keys: Record<string, ExploreAction> = orientation === 'LR'
    ? { ArrowUp: 'previous', ArrowDown: 'next', ArrowRight: 'follow', ArrowLeft: 'back' }
    : { ArrowLeft: 'previous', ArrowRight: 'next', ArrowDown: 'follow', ArrowUp: 'back' };
  return keys[key] ?? null;
}

const edgeOrder = { evidence: 0, affinity: 1, follows: 2 };

export function buildExploreIndex(nodes: ExploreNode[], edges: GraphEdge[]): ExploreIndex {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const neighbors = new Map<string, Map<string, ExploreLink>>();
  for (const edge of edges) {
    if (edge.from === edge.to || !byId.has(edge.from) || !byId.has(edge.to)) continue;
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const links = neighbors.get(from) ?? new Map<string, ExploreLink>();
      const previous = links.get(to);
      if (!previous || edgeOrder[edge.kind] < edgeOrder[previous.edge.kind]
        || (edge.kind === previous.edge.kind && edge.weight > previous.edge.weight)) {
        links.set(to, { node: byId.get(to)!, edge });
      }
      neighbors.set(from, links);
    }
  }
  return {
    nodes: byId,
    links: new Map([...neighbors].map(([id, links]) => [id, [...links.values()].sort((a, b) =>
      edgeOrder[a.edge.kind] - edgeOrder[b.edge.kind]
      || b.edge.weight - a.edge.weight
      || a.node.label.localeCompare(b.node.label)
      || a.node.id.localeCompare(b.node.id))])),
  };
}

export function exploreConnections(index: ExploreIndex, id: string, includeScout = false): ExploreLink[] {
  return (index.links.get(id) ?? []).filter(({ node }) => includeScout || node.kind !== 'scout');
}

export function exploreForwardConnections(index: ExploreIndex, id: string, trailIds: Set<string>, includeScout = false): ExploreLink[] {
  return exploreConnections(index, id, includeScout).filter(({ node }) => !trailIds.has(node.id));
}

export function exploreStarts(index: ExploreIndex, kind: 'topic' | 'source'): ExploreNode[] {
  return [...index.nodes.values()].filter((node) => node.kind === kind).sort((a, b) => {
    if (kind === 'source') return 0;
    return exploreConnections(index, b.id).length - exploreConnections(index, a.id).length
      || a.label.localeCompare(b.label);
  });
}

export function connectionReason(from: ExploreNode, to: ExploreNode, edge: GraphEdge): string {
  if (edge.kind === 'follows') return to.self || to.id === 'person:self' ? 'You follow this account' : 'An account you follow';
  if (from.kind === 'scout' || to.kind === 'scout') return 'Scout suggestion for this topic';
  if (edge.kind === 'affinity') return 'Overlapping bookmark patterns';
  if (from.kind === 'source') return to.kind === 'person' ? 'Author of this bookmark' : 'Topic of this bookmark';
  if (to.kind === 'source') return from.kind === 'person' ? 'A post saved from this author' : 'A bookmark on this topic';
  return 'Connected through saved posts';
}

export function explorePreview(index: ExploreIndex, fromId: string, excluded: Set<string>, includeScout = false, preferredId?: string) {
  const candidates = exploreConnections(index, fromId, includeScout).filter(({ node }) =>
    !excluded.has(node.id) && !node.self && node.id !== 'person:self');
  return candidates.find(({ node }) => node.id === preferredId) ?? candidates[0];
}

export function visitExploreTrail(trail: ExploreTrail, ids: string[]): ExploreTrail {
  const steps: string[] = [];
  for (const id of [...trail.steps.slice(0, trail.cursor + 1), ...ids]) {
    const earlier = steps.indexOf(id);
    if (earlier >= 0) steps.splice(earlier + 1);
    else steps.push(id);
  }
  const bounded = steps.slice(-80);
  return { steps: bounded, cursor: bounded.length - 1 };
}

export function reconcileExploreOrder(previous: string[], next: string[]): string[] {
  const available = new Set(next);
  const kept = previous.filter((id) => available.delete(id));
  return [...kept, ...available];
}

export function pruneExploreTrail(trail: ExploreTrail, available: Set<string>): ExploreTrail {
  return {
    steps: trail.steps.filter((id) => available.has(id)),
    cursor: trail.steps.slice(0, trail.cursor + 1).filter((id) => available.has(id)).length - 1,
  };
}
