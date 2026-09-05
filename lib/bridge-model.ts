import type { ExploreIndex } from './explore-model.ts';

export type ConceptBridge = {
  id: string;
  conceptIds: string[];
  nodeIds: string[];
  hops: Array<{ from: string; to: string; bookmarkIds: string[] }>;
};
export type BridgeInterpretation = {
  routeId: string | null;
  explanation: string;
  hops: Array<{ from: string; to: string; explanation: string }>;
  suggestedConcepts: string[];
  nextQuestion: string;
};
export const BRIDGE_MAX_HOPS = 6;
const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());

/** A conceptual link needs a saved post assigned to both topics. */
export function findConceptBridges(index: ExploreIndex, from: string, to: string): ConceptBridge[] {
  if (from === to || index.nodes.get(from)?.kind !== 'topic' || index.nodes.get(to)?.kind !== 'topic') return [];
  const pairs = new Map<string, string[]>();
  const neighbors = new Map<string, Set<string>>();
  const posts = [...index.nodes.values()].filter((node) => node.kind === 'source').sort((a, b) => a.id.localeCompare(b.id));
  for (const post of posts) {
    const topics = (index.links.get(post.id) ?? []).filter(({ node, edge }) => node.kind === 'topic' && edge.kind === 'evidence').map(({ node }) => node.id);
    for (let a = 0; a < topics.length; a += 1) {
      for (let b = a + 1; b < topics.length; b += 1) {
        const first = topics[a], second = topics[b];
        const key = pairKey(first, second);
        pairs.set(key, [...(pairs.get(key) ?? []), post.id]);
        for (const [start, end] of [[first, second], [second, first]]) {
          const next = neighbors.get(start) ?? new Set();
          next.add(end);
          neighbors.set(start, next);
        }
      }
    }
  }
  const shortest = (blocked: Set<string>) => {
    const queue: string[][] = [[from]];
    const seen = new Set([from]);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const path = queue[cursor];
      const last = path.at(-1)!;
      if (last === to) return path;
      if (path.length > BRIDGE_MAX_HOPS) continue;
      const next = [...(neighbors.get(last) ?? [])].sort((a, b) =>
        (pairs.get(pairKey(last, b))?.length ?? 0) - (pairs.get(pairKey(last, a))?.length ?? 0) || a.localeCompare(b));
      for (const neighbor of next) {
        if (seen.has(neighbor) || blocked.has(pairKey(last, neighbor))) continue;
        seen.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
    return null;
  };
  const first = shortest(new Set());
  if (!first) return [];
  const paths = [first];
  for (let i = 1; i < first.length; i += 1) {
    const alternate = shortest(new Set([pairKey(first[i - 1], first[i])]));
    if (alternate && !paths.some((path) => JSON.stringify(path) === JSON.stringify(alternate))) paths.push(alternate);
  }
  return paths.sort((a, b) => a.length - b.length).flatMap((conceptIds) => {
    const nodeIds = [from];
    const hops: ConceptBridge['hops'] = [];
    for (let cursor = 1; cursor < conceptIds.length; cursor += 1) {
      const previous = conceptIds[cursor - 1], next = conceptIds[cursor];
      const bookmarkIds = pairs.get(pairKey(previous, next))!;
      const witness = bookmarkIds.find((id) => !nodeIds.includes(id));
      if (!witness) return [];
      hops.push({ from: previous, to: next, bookmarkIds });
      nodeIds.push(witness, next);
    }
    return [{ id: JSON.stringify(conceptIds), conceptIds, nodeIds, hops }];
  }).slice(0, 3);
}

export function bridgeIsAvailable(index: ExploreIndex, route: ConceptBridge): boolean {
  return route.nodeIds.every((id, cursor) => index.nodes.has(id) && (cursor === 0
    || index.links.get(route.nodeIds[cursor - 1])?.some(({ node, edge }) => node.id === id && edge.kind === 'evidence')));
}

/** Send only route concepts and a small set of excerpts, with opaque references. */
export function bridgePromptContext(index: ExploreIndex, from: string, to: string, routes: ConceptBridge[]) {
  const conceptIds = new Set([from, to, ...routes.flatMap((route) => route.conceptIds)]);
  const refById = new Map([...conceptIds].map((id, position) => [id, `c${position + 1}`]));
  const sourceIds = new Set(routes.flatMap((route) => route.hops.map((hop) => hop.bookmarkIds[0])));
  routes.forEach((route) => route.hops.forEach((hop) => hop.bookmarkIds.slice(0, 2).forEach((id) => sourceIds.add(id))));
  if (!routes.length) {
    for (const id of [from, to]) {
      (index.links.get(id) ?? []).filter(({ node, edge }) => node.kind === 'source' && edge.kind === 'evidence').slice(0, 4)
        .forEach(({ node }) => sourceIds.add(node.id));
    }
  }
  const postRefs = new Map([...sourceIds].slice(0, 24).map((id, position) => [id, `p${position + 1}`]));
  const excerpt = (value: string) => value.replace(/https?:\/\/\S+/g, '[link]').replace(/@[a-z0-9_]+/gi, '[account]').slice(0, 400);
  return {
    from: refById.get(from), to: refById.get(to),
    concepts: [...refById].map(([id, ref]) => ({ ref, label: index.nodes.get(id)!.label })),
    routes: routes.map((route, position) => ({
      ref: `r${position + 1}`,
      hops: route.hops.map((hop) => ({ from: refById.get(hop.from), to: refById.get(hop.to), posts: hop.bookmarkIds.flatMap((id) => postRefs.has(id) ? [postRefs.get(id)!] : []) })),
    })),
    posts: [...postRefs].map(([id, ref]) => ({ ref, excerpt: excerpt(index.nodes.get(id)!.note), concepts: [...conceptIds].filter((topic) => index.links.get(id)?.some(({ node, edge }) => node.id === topic && edge.kind === 'evidence')).map((topic) => refById.get(topic)) })),
  };
}

export function parseBridgeInterpretation(value: unknown, routes: ConceptBridge[], context: ReturnType<typeof bridgePromptContext>): BridgeInterpretation | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const string = (entry: unknown, max: number) => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= max;
  if (!string(data.explanation, 1000) || !string(data.nextQuestion, 300) || !Array.isArray(data.hops) || !Array.isArray(data.suggestedConcepts)) return null;
  const routeIndex = context.routes.findIndex((route) => route.ref === data.routeRef);
  if (routes.length && routeIndex < 0) return null;
  if (!routes.length && (data.routeRef !== null || data.hops.length > 0)) return null;
  const route = routes[routeIndex];
  if (route && (data.hops.length !== route.hops.length || data.suggestedConcepts.length)) return null;
  const hops: BridgeInterpretation['hops'] = [];
  for (let i = 0; i < data.hops.length; i += 1) {
    const hop = data.hops[i] as Record<string, unknown> | null;
    const expected = context.routes[routeIndex]?.hops[i];
    if (!hop || !expected || hop.from !== expected.from || hop.to !== expected.to || !string(hop.explanation, 500)) return null;
    hops.push({ from: route.hops[i].from, to: route.hops[i].to, explanation: (hop.explanation as string).trim() });
  }
  if (data.suggestedConcepts.length > 4 || data.suggestedConcepts.some((concept) => !string(concept, 80))) return null;
  return { routeId: route?.id ?? null, explanation: (data.explanation as string).trim(), hops, suggestedConcepts: (data.suggestedConcepts as string[]).map((label) => label.trim()), nextQuestion: (data.nextQuestion as string).trim() };
}
