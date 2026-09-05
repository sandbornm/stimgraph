export const SELF_NODE_ID = 'person:self';

export type EdgeKind = 'evidence' | 'affinity' | 'follows';

export type GraphEdge = {
  from: string;
  to: string;
  weight: number;
  kind: EdgeKind;
};

export type SearchKind = 'topic' | 'person' | 'source' | 'scout' | 'command' | 'following' | null;

export function isSelfId(id: string) {
  return id === SELF_NODE_ID;
}

export function isFollowOnlyEvidence(evidence: string) {
  return evidence.startsWith('Following');
}

export function isFollowOnlyPerson(kind: string, followed: boolean | undefined, evidence: string, id?: string) {
  return kind === 'person' && Boolean(followed) && isFollowOnlyEvidence(evidence) && !isSelfId(id ?? '');
}

export function buildFollowsEdges(
  selfId: string,
  people: Array<{ id: string; kind: string; followed?: boolean; evidence: string }>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const person of people) {
    if (person.id === selfId || person.kind !== 'person' || !person.followed) continue;
    edges.push({
      from: selfId,
      to: person.id,
      weight: isFollowOnlyEvidence(person.evidence) ? 0.56 : 0.34,
      kind: 'follows',
    });
  }
  return edges;
}

export function collectNeighborhoodIds(
  rootId: string,
  nodes: Array<{ id: string }>,
  edges: GraphEdge[],
  depth: number,
): Set<string> {
  const available = new Set(nodes.map((node) => node.id));
  const visited = new Set<string>(available.has(rootId) ? [rootId] : []);
  let frontier = new Set(visited);
  const structural: GraphEdge[] = [];
  const follows: GraphEdge[] = [];
  for (const edge of edges) {
    if (edge.kind === 'follows') follows.push(edge);
    else structural.push(edge);
  }

  for (let step = 0; step < depth; step += 1) {
    const next = new Set<string>();
    for (const edge of structural) {
      if (frontier.has(edge.from) && available.has(edge.to) && !visited.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && available.has(edge.from) && !visited.has(edge.from)) next.add(edge.from);
    }
    const expandFollows = rootId === SELF_NODE_ID && frontier.has(SELF_NODE_ID);
    for (const edge of follows) {
      if (expandFollows && frontier.has(edge.from) && available.has(edge.to) && !visited.has(edge.to)) {
        next.add(edge.to);
      }
      if (frontier.has(edge.to) && available.has(edge.from) && !visited.has(edge.from)) {
        next.add(edge.from);
      }
    }
    next.forEach((id) => visited.add(id));
    frontier = next;
    if (frontier.size === 0) break;
  }
  return visited;
}

export function matchScore(haystack: string, needle: string) {
  if (!needle) return 1;
  const hay = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return 1;
  if (hay === n) return 100;
  const at = hay.indexOf(n);
  if (at < 0) return 0;
  if (at === 0) return 92;
  const before = hay[at - 1];
  if (before === ' ' || before === '·' || before === '-' || before === '/' || before === '_' || before === '@' || before === '#') return 80;
  return Math.max(12, 48 - Math.min(30, at));
}

export function parseSearch(raw: string): { needle: string; kind: SearchKind } {
  const trimmed = raw.trim();
  if (trimmed.startsWith('@')) return { needle: trimmed.slice(1).trim(), kind: 'person' };
  if (trimmed.startsWith('#')) return { needle: trimmed.slice(1).trim(), kind: 'topic' };
  if (trimmed.startsWith('*')) return { needle: trimmed.slice(1).trim(), kind: 'scout' };
  if (trimmed.startsWith('~')) return { needle: trimmed.slice(1).trim(), kind: 'following' };
  if (trimmed.startsWith(':') || trimmed.startsWith('>')) return { needle: trimmed.slice(1).trim(), kind: 'command' };
  return { needle: trimmed, kind: null };
}

export type SearchNode = {
  id: string;
  label: string;
  kind: string;
  note: string;
  evidence: string;
  size: number;
  followed?: boolean;
  searchLabel?: string;
};

export type SearchHit = {
  id: string;
  label: string;
  detail: string;
  kind: string;
  score: number;
};

export function rankSearchHits(
  raw: string,
  nodes: SearchNode[],
  commands: ReadonlyArray<{ id: string; label: string; detail: string }>,
): SearchHit[] {
  const parsed = parseSearch(raw);
  const needle = parsed.needle;
  const hits: SearchHit[] = [];
  if (parsed.kind !== 'command') {
    for (const node of nodes) {
      if (parsed.kind === 'following') {
        if (node.kind !== 'person' || !node.followed) continue;
      } else if (parsed.kind && node.kind !== parsed.kind) continue;
      const label = node.searchLabel ?? node.label;
      let score = needle ? matchScore(label, needle) : node.size;
      if (needle && score <= 0 && needle.length >= 2) {
        score = matchScore(node.note, needle) * 0.7;
      }
      if (needle && score <= 0) continue;
      hits.push({
        id: node.id,
        label: node.label,
        detail: node.kind === 'source' ? 'bookmark' : isSelfId(node.id) ? 'you' : node.kind,
        kind: node.kind,
        score,
      });
    }
  }
  if (!parsed.kind || parsed.kind === 'command') {
    commands.forEach((command, order) => {
      const score = needle
        ? Math.max(matchScore(command.label, needle), matchScore(command.detail, needle) * 0.6)
        : 20 - order;
      if (needle && score <= 0) return;
      hits.push({ id: command.id, label: command.label, detail: command.detail, kind: 'command', score });
    });
  }
  hits.sort((first, second) => second.score - first.score || first.label.localeCompare(second.label));
  if (!needle && !parsed.kind) {
    return [
      ...hits.filter((hit) => hit.kind === 'command'),
      ...hits.filter((hit) => hit.kind !== 'command').slice(0, 8),
    ];
  }
  return hits.slice(0, 28);
}

export function withSearchLabel<T extends { label: string }>(node: T): T & { searchLabel: string } {
  return { ...node, searchLabel: node.label.toLowerCase() };
}
