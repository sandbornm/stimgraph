export type CapsuleNode = {
  id: string;
  label: string;
  kind: 'topic' | 'person';
  x: number;
  y: number;
  size: number;
  color: string;
  note: string;
  evidence: string;
  origin: 'seed';
};

export type CapsuleEdge = {
  from: string;
  to: string;
  weight: number;
  kind: 'evidence' | 'affinity';
};

export type GraphCapsule = {
  version: 1;
  name: string;
  rootId: string | null;
  nodes: CapsuleNode[];
  edges: CapsuleEdge[];
};

export function parseCapsule(value: unknown): GraphCapsule | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<GraphCapsule>;
  if (input.version !== 1 || typeof input.name !== 'string' || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) return null;
  const nodes = input.nodes.slice(0, 120).filter((node): node is CapsuleNode => Boolean(
    node && typeof node.id === 'string' && typeof node.label === 'string' &&
    (node.kind === 'topic' || node.kind === 'person') && typeof node.x === 'number' &&
    typeof node.y === 'number' && typeof node.size === 'number' && typeof node.color === 'string',
  )).map((node) => ({
    ...node,
    note: typeof node.note === 'string' ? node.note.slice(0, 240) : 'Shared node.',
    evidence: 'Shared neighborhood · Bookmark text withheld',
    url: undefined,
    origin: 'seed' as const,
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = input.edges.slice(0, 360).filter((edge): edge is CapsuleEdge => Boolean(
    edge && typeof edge.from === 'string' && typeof edge.to === 'string' &&
    nodeIds.has(edge.from) && nodeIds.has(edge.to) && typeof edge.weight === 'number' &&
    (edge.kind === 'evidence' || edge.kind === 'affinity'),
  )).map((edge) => ({ ...edge, weight: Math.max(0, Math.min(1, edge.weight)) }));
  if (nodes.length === 0) return null;
  return { version: 1, name: input.name.slice(0, 60), rootId: typeof input.rootId === 'string' ? input.rootId : null, nodes, edges };
}

export function newShareId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '').slice(0, 10);
}
