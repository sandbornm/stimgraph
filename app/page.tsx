'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { readNdjson } from '@/lib/read-ndjson';

type NodeKind = 'topic' | 'person' | 'source' | 'scout';

type StimNode = {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  size: number;
  color: string;
  note: string;
  evidence: string;
  url?: string;
  origin?: 'local' | 'seed' | 'bridge';
  followed?: boolean;
};

type Edge = {
  from: string;
  to: string;
  weight: number;
  kind: 'evidence' | 'affinity';
};

type GraphCapsule = {
  version: 1;
  name: string;
  rootId: string | null;
  nodes: StimNode[];
  edges: Edge[];
};

type GraphTuning = {
  density: number;
  signalFloor: number;
  motion: number;
  affinities: boolean;
  guides: boolean;
  labels: 'focus' | 'topics' | 'all';
  palette: 'spectrum' | 'phosphor' | 'ice';
};

const defaultTuning: GraphTuning = {
  density: 80,
  signalFloor: 22,
  motion: 42,
  affinities: true,
  guides: true,
  labels: 'topics',
  palette: 'phosphor',
};

const tuningPresets: Array<{ name: string; value: GraphTuning }> = [
  { name: 'Quiet', value: { density: 42, signalFloor: 48, motion: 18, affinities: false, guides: false, labels: 'focus', palette: 'ice' } },
  { name: 'Balanced', value: defaultTuning },
  { name: 'Charged', value: { density: 100, signalFloor: 12, motion: 86, affinities: true, guides: true, labels: 'all', palette: 'spectrum' } },
];

function stableFraction(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function isFollowOnly(node: StimNode) {
  return node.kind === 'person' && Boolean(node.followed) && node.evidence.startsWith('Following');
}

function tunedNodeColor(node: StimNode, palette: GraphTuning['palette']) {
  if (node.kind === 'scout') return '#7ee0ff';
  if (node.origin === 'bridge') return '#c8ff3c';
  const followOnly = isFollowOnly(node);
  if (palette === 'phosphor') {
    if (node.kind === 'topic') return '#c8ff3c';
    if (followOnly) return '#8a947c';
    if (node.kind === 'person') return '#e8f3d8';
    return '#6d7a62';
  }
  if (palette === 'ice') {
    if (node.kind === 'topic') return '#7ee0ff';
    if (followOnly) return '#7d93a0';
    if (node.kind === 'person') return '#e8f7ff';
    return '#718892';
  }
  return node.color;
}

function drawDiamond(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.beginPath();
  context.moveTo(x, y - radius);
  context.lineTo(x + radius, y);
  context.lineTo(x, y + radius);
  context.lineTo(x - radius, y);
  context.closePath();
}

type SpherePoint = { x: number; y: number; z: number };

function nodeToSphere(node: StimNode): SpherePoint {
  const dx = node.x - 0.5;
  const dy = (node.y - 0.5) / 0.78;
  const radius = Math.hypot(dx, dy);
  if (radius < 1e-5) return { x: 0, y: 0, z: 1 };
  const lon = Math.atan2(dy, dx);
  const colat = Math.PI * 0.66 * (radius / 0.48) ** 1.06;
  const sine = Math.sin(Math.min(colat, Math.PI * 0.92));
  return {
    x: sine * Math.cos(lon),
    y: sine * Math.sin(lon),
    z: Math.cos(Math.min(colat, Math.PI * 0.92)),
  };
}

function rotateSphere(point: SpherePoint, yaw: number, pitch: number): SpherePoint {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const x1 = point.x * cosYaw + point.z * sinYaw;
  const z1 = -point.x * sinYaw + point.z * cosYaw;
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  return {
    x: x1,
    y: point.y * cosPitch - z1 * sinPitch,
    z: point.y * sinPitch + z1 * cosPitch,
  };
}

function facingAngles(point: SpherePoint) {
  return {
    yaw: Math.atan2(-point.x, point.z),
    pitch: Math.max(-1.2, Math.min(1.2, Math.atan2(point.y, Math.hypot(point.x, point.z)))),
  };
}

function lerpAngle(from: number, to: number, amount: number) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * amount;
}

function clampPitch(value: number) {
  return Math.max(-1.2, Math.min(1.2, value));
}

function sphereFromLonLat(lon: number, lat: number): SpherePoint {
  const cosLat = Math.cos(lat);
  return {
    x: cosLat * Math.sin(lon),
    y: Math.sin(lat),
    z: cosLat * Math.cos(lon),
  };
}

function slerpSphere(from: SpherePoint, to: SpherePoint, amount: number): SpherePoint {
  const dot = Math.min(1, Math.max(-1, from.x * to.x + from.y * to.y + from.z * to.z));
  const theta = Math.acos(dot);
  if (theta < 1e-4) return from;
  const sinTheta = Math.sin(theta);
  const start = Math.sin((1 - amount) * theta) / sinTheta;
  const end = Math.sin(amount * theta) / sinTheta;
  return {
    x: from.x * start + to.x * end,
    y: from.y * start + to.y * end,
    z: from.z * start + to.z * end,
  };
}

function hexRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  if (value.length < 6) return `rgba(220, 232, 216, ${alpha})`;
  return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

function layerRadius(node: StimNode) {
  if (node.kind === 'topic') return 0.76;
  if (node.kind === 'scout') return 1.14;
  if (node.kind === 'source') return 1.05;
  if (isFollowOnly(node)) return 1.08;
  return 0.94;
}

const demoTopicSeeds = [
  ['Generative interfaces', '#c8ff3c', 'Interfaces that make abstract systems tangible, spatial, and responsive.'],
  ['Agent ecologies', '#72e7ff', 'How many specialized agents coordinate, disagree, and hand work to one another.'],
  ['Tools for thought', '#b39cff', 'Memory, notation, and navigation systems built around relationships.'],
  ['Creative code', '#ffcf66', 'Computation used as a material for images, sound, and interaction.'],
  ['Collective intelligence', '#8de4bb', 'Structures that help groups notice, decide, and learn together.'],
  ['Machine perception', '#ff8f70', 'What models and organisms attend to, compress, and miss.'],
  ['Protocol design', '#d6a7ff', 'Rules and rituals that make coordination possible.'],
  ['Living archives', '#86d8ca', 'Collections that reorganize themselves as interests change.'],
  ['Spatial computing', '#86b9ff', 'Interfaces that treat rooms, bodies, and movement as inputs.'],
  ['Counterculture systems', '#ffc07a', 'Small experiments that redraw the edges of institutions.'],
] as const;

const demoPeopleSeeds = [
  ['Mira Chen', '@mirafields', [0, 2, 8]], ['Jules Soto', '@softprotocol', [1, 4, 6]],
  ['Noor Okafor', '@noorbuilds', [0, 3, 5]], ['Theo Park', '@theopark', [2, 7, 9]],
  ['Ana Vale', '@anavale', [3, 5, 8]], ['Luc Morel', '@lucentlab', [0, 1, 3]],
  ['Priya Nair', '@priyanair', [2, 4, 7]], ['Ellis Kline', '@ellisk', [1, 6, 9]],
  ['Imani Brooks', '@imanib', [4, 5, 9]], ['Owen Cai', '@owencai', [0, 2, 6]],
  ['Sora Ito', '@soraito', [3, 7, 8]], ['Ada Moreno', '@adamoreno', [1, 4, 8]],
  ['Remy Singh', '@remysingh', [2, 5, 7]], ['Lena Adebayo', '@lenaade', [0, 6, 9]],
  ['Nico Bell', '@nicobell', [1, 3, 5]], ['Rowan Hart', '@rowanhart', [2, 4, 9]],
  ['Zoe Kim', '@zoekim', [0, 7, 8]], ['Maya Torres', '@mayatorres', [3, 4, 6]],
  ['Ren Wu', '@renwu', [1, 5, 8]], ['Sol Alvarez', '@solalvarez', [2, 7, 9]],
  ['Ari Feld', '@arifeld', [0, 3, 4]], ['Tess Morgan', '@tessmorgan', [1, 6, 7]],
  ['Lia Dlamini', '@liadlamini', [5, 8, 9]], ['Kiran Shah', '@kiranshah', [0, 2, 5]],
  ['Evan Rhee', '@evanrhee', [3, 6, 8]], ['Amal Idris', '@amalidris', [1, 4, 7]],
  ['Cleo Martin', '@cleomartin', [0, 5, 9]], ['Dani Rocha', '@danirocha', [2, 3, 6]],
] as const;

const demoBookmarkSeeds = [
  ['Interfaces that bloom around intent', 0, [0, 8]], ['A field guide to agent handoffs', 1, [1, 6]],
  ['Drawing with model uncertainty', 2, [3, 5]], ['Notes that find their own neighbors', 3, [2, 7]],
  ['Making software feel like wet clay', 4, [0, 3]], ['Small models, strange collaborations', 5, [1, 4]],
  ['The archive as an instrument', 6, [2, 7]], ['Protocols for productive disagreement', 7, [4, 6]],
  ['What collective attention leaves out', 8, [4, 5]], ['A grammar for explorable ideas', 9, [0, 2]],
  ['Generative scores for public space', 10, [3, 8]], ['Agents that negotiate shared context', 11, [1, 4]],
  ['Memory without folders', 12, [2, 7]], ['Building institutions at human scale', 13, [6, 9]],
  ['Perception as a creative constraint', 14, [3, 5]], ['Gardens, graphs, and unfinished thought', 15, [2, 7]],
  ['Rooms that respond without screens', 16, [0, 8]], ['Rules for open-ended games', 17, [4, 6]],
  ['The texture of synthetic attention', 18, [1, 5]], ['Counter-archives for lost futures', 19, [7, 9]],
  ['Code as choreography', 20, [0, 3]], ['Coordination without a control room', 21, [1, 6]],
  ['Embodied prompts and spatial memory', 22, [5, 8]], ['Why maps should remain incomplete', 23, [0, 2]],
  ['Software for temporary publics', 24, [6, 8]], ['A protocol for collective noticing', 25, [4, 7]],
  ['Beautiful friction in creative tools', 26, [0, 9]], ['Sketching systems with sound', 27, [3, 6]],
  ['Peripheral vision for knowledge work', 0, [2, 5]], ['Let weak signals stay weak', 1, [1, 7]],
  ['Interfaces for more-than-human data', 2, [0, 5]], ['The social life of a saved link', 3, [4, 7]],
  ['Tiny tools with long half-lives', 4, [3, 9]], ['Models as participants, not oracles', 5, [1, 4]],
  ['Rehearsing possible institutions', 6, [6, 9]], ['Spatial annotations for ordinary rooms', 7, [2, 8]],
  ['A notebook that forgets on purpose', 8, [2, 5]], ['Signals from the edge of the network', 9, [4, 9]],
  ['Composable rituals for research teams', 10, [6, 7]], ['When an interface becomes a place', 11, [0, 8]],
] as const;

const demoFollowedIndexes = new Set([0, 2, 4, 7, 11, 15]);

const demoFollowOnlySeeds = [
  ['Ivy Holm', '@ivyholm', 'Writes about civic software and unfinished public tools.'],
  ['Cal Nguyen', '@calnguyen', 'Maps informal coordination in small labs.'],
  ['June Okada', '@juneokada', 'Makes scores for rooms instead of screens.'],
  ['Paz Ortega', '@pazortega', 'Collects protocols that refuse a leaderboard.'],
  ['Ned Faiz', '@nedfaiz', 'Keeps a notebook of weak institutional signals.'],
] as const;

const demoScoutSeeds = [
  ['A runtime that treats prompts as rooms', 0, 'New spatial-computing thread adjacent to your saved interfaces.'],
  ['Weak-signal notebooks that refuse ranking', 2, 'Fits tools for thought without turning attention into a feed.'],
  ['Agents that argue in public, then commit', 1, 'Handoff pattern next to your agent-ecology bookmarks.'],
  ['Archives that rot on purpose', 7, 'Living-archive adjacent; keeps decay as a design material.'],
  ['Counter-maps for model evaluation', 5, 'Machine perception from the edge, not the leaderboard.'],
  ['A protocol for unfinished software', 6, 'Coordination rules that leave the system incomplete on purpose.'],
] as const;

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function nowMs() {
  return Date.now();
}

function randomOffset(span: number) {
  return 1 + Math.floor(Math.random() * Math.max(1, span));
}

function matchScore(haystack: string, needle: string) {
  if (!needle) return 1;
  const hay = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return 1;
  if (hay === n) return 100;
  const at = hay.indexOf(n);
  if (at < 0) return 0;
  if (at === 0) return 92;
  const before = hay[at - 1];
  if (before === ' ' || before === '·' || before === '-' || before === '/' || before === '_') return 80;
  return Math.max(12, 48 - Math.min(30, at));
}

type PaletteHit = {
  id: string;
  label: string;
  detail: string;
  kind: NodeKind | 'command';
  score: number;
};

function demoFieldPosition(index: number, count: number, ring: 'inner' | 'outer') {
  const angle = index * Math.PI * (3 - Math.sqrt(5)) + (ring === 'inner' ? -0.7 : 0.25);
  const progress = Math.sqrt((index + 0.7) / count);
  const radius = ring === 'inner' ? 0.05 + progress * 0.24 : 0.28 + progress * 0.18;
  return { x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius * 0.76 };
}

function buildDemoGraph(): { nodes: StimNode[]; edges: Edge[] } {
  const topics: StimNode[] = demoTopicSeeds.map(([label, color, note], index) => ({
    id: `topic:${slug(label)}`,
    label,
    kind: 'topic',
    ...demoFieldPosition(index, demoTopicSeeds.length, 'inner'),
    size: 12 + (index % 4),
    color,
    note,
    evidence: `${6 + ((index * 7) % 15)} demo bookmarks`,
  }));
  const people: StimNode[] = demoPeopleSeeds.map(([name, handle], index) => {
    const followed = demoFollowedIndexes.has(index);
    const saved = 2 + (index % 7);
    return {
      id: `person:${slug(handle)}`,
      label: `${name} · ${handle}`,
      kind: 'person',
      ...demoFieldPosition(index, demoPeopleSeeds.length + demoFollowOnlySeeds.length, 'outer'),
      size: 6 + (index % 5) * 0.55 + (followed ? 0.6 : 0),
      color: '#f4f1e9',
      note: followed
        ? `${handle} is someone you follow, and they appear near several saved threads in this fictional demo.`
        : `${handle} appears near several saved threads in this fictional demo constellation.`,
      evidence: followed ? `${saved} demo bookmarks · Following` : `${saved} demo bookmarks`,
      followed,
    };
  });
  const followOnly: StimNode[] = demoFollowOnlySeeds.map(([name, handle, note], index) => ({
    id: `person:${slug(handle)}`,
    label: `${name} · ${handle}`,
    kind: 'person',
    ...demoFieldPosition(demoPeopleSeeds.length + index, demoPeopleSeeds.length + demoFollowOnlySeeds.length, 'outer'),
    size: 5.4,
    color: '#8f9888',
    note: `You follow ${handle}. No saved posts from them yet. ${note}`,
    evidence: 'Following · Demo data',
    followed: true,
  }));
  const sources: StimNode[] = demoBookmarkSeeds.map(([label, personIndex], index) => {
    const anchor = people[personIndex];
    const angle = (index * 2.399963 + personIndex) % (Math.PI * 2);
    const distance = 0.045 + (index % 5) * 0.013;
    return {
      id: `bookmark:demo-${index}`,
      label,
      kind: 'source',
      x: Math.min(0.96, Math.max(0.04, anchor.x + Math.cos(angle) * distance)),
      y: Math.min(0.95, Math.max(0.05, anchor.y + Math.sin(angle) * distance * 0.7)),
      size: 3 + (index % 3) * 0.45,
      color: '#8f9c93',
      note: `A fictional saved post about ${label.toLowerCase()}, included to show how bookmark evidence surrounds people and themes.`,
      evidence: `Saved from ${demoPeopleSeeds[personIndex][1]} · Demo data`,
    } satisfies StimNode;
  });
  const scouts: StimNode[] = demoScoutSeeds.map(([label, topicIndex, reason], index) => {
    const topic = topics[topicIndex];
    const angle = (index * 1.7 + 0.4) % (Math.PI * 2);
    const distance = 0.11 + (index % 3) * 0.018;
    return {
      id: `scout:demo-${index}`,
      label,
      kind: 'scout' as const,
      x: Math.min(0.96, Math.max(0.04, topic.x + Math.cos(angle) * distance)),
      y: Math.min(0.95, Math.max(0.05, topic.y + Math.sin(angle) * distance * 0.7)),
      size: 4.4,
      color: '#7ee0ff',
      note: `A fictional scouted post: ${label}.`,
      evidence: `Scouted · ${demoTopicSeeds[topicIndex][0]} · ${reason}`,
    } satisfies StimNode;
  });

  const edges: Edge[] = [];
  demoPeopleSeeds.forEach(([, , topicIndexes], personIndex) => {
    topicIndexes.forEach((topicIndex, connectionIndex) => edges.push({
      from: people[personIndex].id,
      to: topics[topicIndex].id,
      weight: 0.46 + connectionIndex * 0.13,
      kind: 'evidence',
    }));
  });
  demoBookmarkSeeds.forEach(([, personIndex, topicIndexes], sourceIndex) => {
    edges.push({ from: sources[sourceIndex].id, to: people[personIndex].id, weight: 0.38, kind: 'evidence' });
    topicIndexes.forEach((topicIndex) => edges.push({
      from: sources[sourceIndex].id,
      to: topics[topicIndex].id,
      weight: 0.5,
      kind: 'evidence',
    }));
  });
  const topicPairs = new Map<string, number>();
  demoBookmarkSeeds.forEach(([, , topicIndexes]) => {
    for (let firstIndex = 0; firstIndex < topicIndexes.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < topicIndexes.length; secondIndex += 1) {
        const pair = [topicIndexes[firstIndex], topicIndexes[secondIndex]].sort((first, second) => first - second);
        const key = `${pair[0]}:${pair[1]}`;
        topicPairs.set(key, (topicPairs.get(key) ?? 0) + 1);
      }
    }
  });
  topicPairs.forEach((count, key) => {
    const [firstTopic, secondTopic] = key.split(':').map(Number);
    edges.push({
      from: topics[firstTopic].id,
      to: topics[secondTopic].id,
      weight: Math.min(0.64, 0.22 + count * 0.06),
      kind: 'affinity',
    });
  });
  demoPeopleSeeds.forEach(([, , firstTopics], firstIndex) => {
    demoPeopleSeeds.slice(firstIndex + 1).forEach(([, , secondTopics], offset) => {
      const secondTopicSet = new Set<number>(secondTopics);
      const overlap = firstTopics.filter((topic) => secondTopicSet.has(topic)).length;
      if (overlap >= 2) edges.push({
        from: people[firstIndex].id,
        to: people[firstIndex + offset + 1].id,
        weight: 0.24 + overlap * 0.12,
        kind: 'affinity',
      });
    });
  });
  demoScoutSeeds.forEach(([, topicIndex], scoutIndex) => {
    edges.push({
      from: scouts[scoutIndex].id,
      to: topics[topicIndex].id,
      weight: 0.44,
      kind: 'affinity',
    });
  });
  return { nodes: [...topics, ...people, ...followOnly, ...sources, ...scouts], edges };
}

const demoGraph = buildDemoGraph();
const demoNodes = demoGraph.nodes;
const demoEdges = demoGraph.edges;

function semanticNodeKey(node: StimNode) {
  if (node.kind === 'topic') return `topic:${slug(node.label)}`;
  if (node.kind === 'person') {
    const handle = node.label.match(/@[a-z0-9_]+/i)?.[0].toLowerCase();
    return `person:${handle ?? slug(node.label.split('·')[0])}`;
  }
  return node.id;
}

function collectNeighborhoodIds(rootId: string, nodes: StimNode[], edges: Edge[], depth: number) {
  const available = new Set(nodes.map((node) => node.id));
  const visited = new Set<string>(available.has(rootId) ? [rootId] : []);
  let frontier = new Set(visited);
  for (let step = 0; step < depth; step += 1) {
    const next = new Set<string>();
    edges.forEach((edge) => {
      if (frontier.has(edge.from) && available.has(edge.to) && !visited.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && available.has(edge.from) && !visited.has(edge.from)) next.add(edge.from);
    });
    next.forEach((id) => visited.add(id));
    frontier = next;
    if (frontier.size === 0) break;
  }
  return visited;
}

function buildDemoCapsule(): GraphCapsule {
  const overlapIds = new Set([
    'topic:generative-interfaces',
    'topic:tools-for-thought',
    'topic:living-archives',
    'person:mirafields',
    'person:theopark',
  ]);
  const overlapNodes = demoNodes.filter((node) => overlapIds.has(node.id)).map((node) => ({ ...node, origin: 'seed' as const }));
  const newNodes: StimNode[] = [
    { id: 'topic:civic-simulation', label: 'Civic simulation', kind: 'topic', x: .58, y: .32, size: 13, color: '#74b7ff', note: 'Shared models for rehearsing public choices.', evidence: 'Shared neighborhood · Bookmark text withheld', origin: 'seed' },
    { id: 'topic:slow-computing', label: 'Slow computing', kind: 'topic', x: .72, y: .55, size: 12, color: '#8de4bb', note: 'Software that values reflection over throughput.', evidence: 'Shared neighborhood · Bookmark text withheld', origin: 'seed' },
    { id: 'topic:biodesign', label: 'Biodesign', kind: 'topic', x: .54, y: .72, size: 12, color: '#ffcf66', note: 'Design methods shaped by living systems.', evidence: 'Shared neighborhood · Bookmark text withheld', origin: 'seed' },
    { id: 'person:iris-vale', label: 'Iris Vale · @irisvale', kind: 'person', x: .78, y: .26, size: 8, color: '#dce9ff', note: 'A person in the second demo neighborhood.', evidence: 'Shared neighborhood · Bookmark text withheld', origin: 'seed' },
    { id: 'person:maro-kim', label: 'Maro Kim · @marokim', kind: 'person', x: .86, y: .48, size: 8, color: '#dce9ff', note: 'A person in the second demo neighborhood.', evidence: 'Shared neighborhood · Bookmark text withheld', origin: 'seed' },
    { id: 'person:dev-ayo', label: 'Dev Ayo · @devayo', kind: 'person', x: .76, y: .76, size: 7, color: '#dce9ff', note: 'A person in the second demo neighborhood.', evidence: 'Shared neighborhood · Bookmark text withheld', origin: 'seed' },
  ];
  const edges: Edge[] = [
    { from: 'person:iris-vale', to: 'topic:generative-interfaces', weight: .76, kind: 'evidence' },
    { from: 'person:iris-vale', to: 'topic:civic-simulation', weight: .68, kind: 'evidence' },
    { from: 'person:maro-kim', to: 'topic:tools-for-thought', weight: .72, kind: 'evidence' },
    { from: 'person:maro-kim', to: 'topic:slow-computing', weight: .64, kind: 'evidence' },
    { from: 'person:dev-ayo', to: 'topic:living-archives', weight: .7, kind: 'evidence' },
    { from: 'person:dev-ayo', to: 'topic:biodesign', weight: .66, kind: 'evidence' },
    { from: 'person:mirafields', to: 'topic:civic-simulation', weight: .46, kind: 'affinity' },
    { from: 'person:theopark', to: 'topic:slow-computing', weight: .42, kind: 'affinity' },
    { from: 'topic:living-archives', to: 'topic:biodesign', weight: .54, kind: 'affinity' },
  ];
  return { version: 1, name: 'Iris’s field', rootId: 'topic:generative-interfaces', nodes: [...overlapNodes, ...newNodes], edges };
}

function combineGraphs(nodes: StimNode[], edges: Edge[], capsule: GraphCapsule) {
  const localNodes = nodes.filter((node) => node.kind !== 'source');
  const combinedNodes: StimNode[] = localNodes.map((node) => ({
    ...node,
    x: 0.04 + node.x * 0.64,
    origin: 'local',
  }));
  const nodeByKey = new Map(combinedNodes.map((node) => [semanticNodeKey(node), node]));
  const seedIdMap = new Map<string, string>();

  capsule.nodes.filter((node) => node.kind !== 'source').forEach((node) => {
    const key = semanticNodeKey(node);
    const existing = nodeByKey.get(key);
    if (existing) {
      existing.origin = 'bridge';
      existing.x = 0.48 + (existing.x - 0.48) * 0.22;
      existing.size = Math.min(19, existing.size * 1.22);
      existing.color = '#d7ff72';
      existing.evidence = `Appears in your graph and ${capsule.name}`;
      seedIdMap.set(node.id, existing.id);
      return;
    }
    const next = {
      ...node,
      id: `seed:${node.id}`,
      x: 0.34 + node.x * 0.62,
      color: node.kind === 'person' ? '#dce9ff' : node.color,
      origin: 'seed' as const,
    };
    combinedNodes.push(next);
    nodeByKey.set(key, next);
    seedIdMap.set(node.id, next.id);
  });

  const allowed = new Set(combinedNodes.map((node) => node.id));
  const combinedEdges = edges
    .filter((edge) => allowed.has(edge.from) && allowed.has(edge.to))
    .map((edge) => ({ ...edge }));
  capsule.edges.forEach((edge) => {
    const from = seedIdMap.get(edge.from);
    const to = seedIdMap.get(edge.to);
    if (from && to && from !== to) combinedEdges.push({ ...edge, from, to });
  });
  const uniqueEdges = new Map<string, Edge>();
  combinedEdges.forEach((edge) => {
    const key = `${[edge.from, edge.to].sort().join('|')}:${edge.kind}`;
    const previous = uniqueEdges.get(key);
    if (!previous || edge.weight > previous.weight) uniqueEdges.set(key, edge);
  });
  return {
    nodes: combinedNodes,
    edges: [...uniqueEdges.values()],
    rootId: capsule.rootId ? seedIdMap.get(capsule.rootId) ?? null : null,
  };
}

function parseCapsule(value: unknown): GraphCapsule | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<GraphCapsule>;
  if (input.version !== 1 || typeof input.name !== 'string' || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) return null;
  const nodes = input.nodes.slice(0, 120).filter((node): node is StimNode => Boolean(
    node && typeof node.id === 'string' && typeof node.label === 'string' &&
    (node.kind === 'topic' || node.kind === 'person') && typeof node.x === 'number' &&
    typeof node.y === 'number' && typeof node.size === 'number' && typeof node.color === 'string',
  )).map((node) => ({
    ...node,
    note: typeof node.note === 'string' ? node.note.slice(0, 240) : 'Shared neighborhood node.',
    evidence: 'Shared neighborhood · Bookmark text withheld',
    url: undefined,
    origin: 'seed' as const,
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = input.edges.slice(0, 360).filter((edge): edge is Edge => Boolean(
    edge && typeof edge.from === 'string' && typeof edge.to === 'string' &&
    nodeIds.has(edge.from) && nodeIds.has(edge.to) && typeof edge.weight === 'number' &&
    (edge.kind === 'evidence' || edge.kind === 'affinity'),
  )).map((edge) => ({ ...edge, weight: Math.max(0, Math.min(1, edge.weight)) }));
  if (nodes.length === 0) return null;
  return { version: 1, name: input.name.slice(0, 60), rootId: typeof input.rootId === 'string' ? input.rootId : null, nodes, edges };
}

function GraphCanvas({
  nodes,
  edges,
  selectedId,
  query,
  tuning,
  freshIds,
  busy,
  frameToken,
  frameIds,
  onSelect,
}: {
  nodes: StimNode[];
  edges: Edge[];
  selectedId: string | null;
  query: string;
  tuning: GraphTuning;
  freshIds: Set<string>;
  busy: boolean;
  frameToken: number;
  frameIds: string[];
  onSelect: (id: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tuningRef = useRef(tuning);
  const freshIdsRef = useRef(freshIds);
  const busyRef = useRef(busy);
  const nodesRef = useRef(nodes);
  const frameIdsRef = useRef(frameIds);
  const hoverRef = useRef<string | null>(null);
  const cursorRef = useRef({ x: 0, y: 0, active: false });
  const pointerRef = useRef({ x: 0, y: 0, down: false, moved: false });
  const rotationRef = useRef((() => {
    const focused = selectedId ? nodes.find((node) => node.id === selectedId) : null;
    if (!focused) return { yaw: 0.58, pitch: -0.38 };
    const face = facingAngles(nodeToSphere(focused));
    return { yaw: face.yaw + 0.48, pitch: clampPitch(face.pitch - 0.2) };
  })());
  const velocityRef = useRef({ yaw: 0, pitch: 0 });
  const zoomRef = useRef(1);
  const frameRef = useRef(0);
  const lastDrawRef = useRef(0);
  const transformRef = useRef({ left: 0, top: 0, width: 0, height: 0 });
  const globeRef = useRef({ cx: 0, cy: 0, radius: 1 });
  const projectedRef = useRef(new Map<string, { x: number; y: number; z: number; reach?: number }>());
  const cameraAnimRef = useRef({
    active: false,
    start: 0,
    duration: 640,
    fromYaw: 0,
    fromPitch: 0,
    fromZ: 1,
    toYaw: 0,
    toPitch: 0,
    toZ: 1,
  });
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  useEffect(() => {
    tuningRef.current = tuning;
  }, [tuning]);

  useEffect(() => {
    freshIdsRef.current = freshIds;
  }, [freshIds]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    frameIdsRef.current = frameIds;
  }, [frameIds]);

  useEffect(() => {
    if (!frameToken) return;
    const bounds = transformRef.current;
    if (bounds.width < 40) return;
    const wanted = new Set(frameIdsRef.current);
    const pool = nodesRef.current;
    const targets = wanted.size ? pool.filter((node) => wanted.has(node.id)) : pool;
    const fitPool = targets.length ? targets : pool;
    let ax = 0;
    let ay = 0;
    let az = 0;
    fitPool.forEach((node) => {
      const point = nodeToSphere(node);
      ax += point.x;
      ay += point.y;
      az += point.z;
    });
    const length = Math.hypot(ax, ay, az) || 1;
    const centroid = { x: ax / length, y: ay / length, z: az / length };
    const face = facingAngles(centroid);
    let maxAngle = 0.18;
    fitPool.forEach((node) => {
      const point = nodeToSphere(node);
      const dot = Math.min(1, Math.max(-1, point.x * centroid.x + point.y * centroid.y + point.z * centroid.z));
      maxAngle = Math.max(maxAngle, Math.acos(dot));
    });
    const nextZoom = Math.min(2.2, Math.max(0.72, 0.62 / Math.max(0.22, Math.sin(maxAngle) * 1.28)));
    cameraAnimRef.current = {
      active: true,
      start: performance.now(),
      duration: 640,
      fromYaw: rotationRef.current.yaw,
      fromPitch: rotationRef.current.pitch,
      fromZ: zoomRef.current,
      toYaw: face.yaw,
      toPitch: face.pitch,
      toZ: nextZoom,
    };
  }, [frameToken]);

  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return new Set(nodes.map((node) => node.id));
    return new Set(
      nodes
        .filter((node) => `${node.label} ${node.note}`.toLowerCase().includes(normalized))
        .map((node) => node.id),
    );
  }, [nodes, query]);

  const getPoint = useCallback((node: StimNode) => {
    const globe = globeRef.current;
    const rotation = rotationRef.current;
    const point = rotateSphere(nodeToSphere(node), rotation.yaw, rotation.pitch);
    const scale = globe.radius * layerRadius(node);
    return {
      x: globe.cx + point.x * scale,
      y: globe.cy + point.y * scale,
      z: point.z,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { desynchronized: true });
    if (!context) return;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      transformRef.current = { left: 0, top: 0, width: rect.width, height: rect.height };
    };

    const draw = (time: number) => {
      if (document.hidden) return;
      const settings = tuningRef.current;
      const camera = cameraAnimRef.current;
      if (camera.active) {
        const progress = Math.min(1, (time - camera.start) / camera.duration);
        const ease = 1 - (1 - progress) ** 3;
        rotationRef.current = {
          yaw: lerpAngle(camera.fromYaw, camera.toYaw, ease),
          pitch: camera.fromPitch + (camera.toPitch - camera.fromPitch) * ease,
        };
        zoomRef.current = camera.fromZ + (camera.toZ - camera.fromZ) * ease;
        velocityRef.current = { yaw: 0, pitch: 0 };
        if (progress >= 1) camera.active = false;
      }
      const coasting = Math.hypot(velocityRef.current.yaw, velocityRef.current.pitch) > 0.00012;
      const spinning = !pointerRef.current.down && !camera.active && settings.motion > 0 && !prefersReducedMotion;
      const frameInterval = camera.active || coasting || busyRef.current ? 16 : settings.motion === 0 ? 90 : settings.density > 88 ? 32 : 24;
      if (time - lastDrawRef.current < frameInterval) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }
      const dt = Math.min(40, time - lastDrawRef.current);
      lastDrawRef.current = time;
      const { width, height } = transformRef.current;
      const motionStrength = prefersReducedMotion ? 0 : (settings.motion / 100) * (busyRef.current ? 1.4 : 1);
      if (!pointerRef.current.down && coasting) {
        rotationRef.current.yaw += velocityRef.current.yaw;
        rotationRef.current.pitch = clampPitch(rotationRef.current.pitch + velocityRef.current.pitch);
        velocityRef.current.yaw *= 0.94;
        velocityRef.current.pitch *= 0.94;
      } else if (spinning && !coasting) {
        rotationRef.current.yaw += 0.000055 * Math.max(0.22, motionStrength) * dt;
      }
      const motionTime = time * motionStrength;
      const portrait = height > width * 1.05;
      const rightGutter = !portrait && width > 860 ? 210 : 0;
      const fieldWidth = Math.max(240, width - rightGutter);
      const globeRadius = Math.min(fieldWidth, height) * (portrait ? 0.34 : 0.4) * zoomRef.current;
      const globe = {
        cx: fieldWidth * 0.5,
        cy: portrait ? height * 0.36 : height * 0.52,
        radius: globeRadius,
      };
      globeRef.current = globe;
      context.clearRect(0, 0, width, height);

      if (busyRef.current) {
        const sweep = (time * 0.00022) % 1;
        const x = sweep * width;
        const wash = context.createLinearGradient(x - 120, 0, x + 120, 0);
        wash.addColorStop(0, 'rgba(200, 255, 60, 0)');
        wash.addColorStop(0.5, 'rgba(200, 255, 60, 0.045)');
        wash.addColorStop(1, 'rgba(200, 255, 60, 0)');
        context.fillStyle = wash;
        context.fillRect(0, 0, width, height);
      }

      const ice = settings.palette === 'ice';
      const phosphor = settings.palette === 'phosphor';
      const accent = ice ? '#7ee0ff' : phosphor ? '#c8ff3c' : '#d7e4c8';
      const cursor = cursorRef.current;
      const reach = 168;

      if (motionStrength > 0 || busyRef.current) {
        const dustCount = Math.round(28 + settings.density * 0.38);
        for (let index = 0; index < dustCount; index += 1) {
          const seedX = ((index * 73) % 997) / 997;
          const seedY = ((index * 193) % 991) / 991;
          const depth = 0.15 + (index % 11) / 12;
          const parallaxX = cursor.active ? (cursor.x - width / 2) * depth * 0.01 : 0;
          const parallaxY = cursor.active ? (cursor.y - height / 2) * depth * 0.007 : 0;
          const drift = Math.sin(motionTime * 0.00008 + index * 1.71) * 7;
          const x = seedX * width + drift + parallaxX;
          const y = seedY * height + Math.cos(motionTime * 0.00006 + index) * 5 + parallaxY;
          context.fillStyle = `rgba(210, 220, 200, ${0.025 + ((index * 17) % 7) * 0.006})`;
          context.fillRect(x, y, index % 11 === 0 ? 1.35 : 0.6, index % 11 === 0 ? 1.35 : 0.6);
        }
      }

      const halo = context.createRadialGradient(globe.cx, globe.cy, globe.radius * 0.72, globe.cx, globe.cy, globe.radius * 1.34);
      halo.addColorStop(0, hexRgba(accent, 0.03));
      halo.addColorStop(0.55, hexRgba(accent, 0.07));
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      context.fillStyle = halo;
      context.beginPath();
      context.arc(globe.cx, globe.cy, globe.radius * 1.34, 0, Math.PI * 2);
      context.fill();

      const volume = context.createRadialGradient(
        globe.cx - globe.radius * 0.22,
        globe.cy - globe.radius * 0.3,
        globe.radius * 0.04,
        globe.cx,
        globe.cy,
        globe.radius,
      );
      volume.addColorStop(0, ice ? 'rgba(90, 150, 170, 0.07)' : phosphor ? 'rgba(90, 130, 30, 0.06)' : 'rgba(80, 100, 80, 0.05)');
      volume.addColorStop(0.45, 'rgba(8, 10, 12, 0.18)');
      volume.addColorStop(0.82, 'rgba(4, 6, 8, 0.42)');
      volume.addColorStop(1, 'rgba(2, 3, 4, 0.62)');
      context.fillStyle = volume;
      context.beginPath();
      context.arc(globe.cx, globe.cy, globe.radius, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = hexRgba(accent, 0.22);
      context.lineWidth = 1.05;
      context.beginPath();
      context.arc(globe.cx, globe.cy, globe.radius, 0, Math.PI * 2);
      context.stroke();

      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let index = 0; index < 72; index += 1) {
        const gy = 1 - (index / 71) * 2;
        const gr = Math.sqrt(Math.max(0, 1 - gy * gy));
        const theta = golden * index;
        const star = rotateSphere({ x: Math.cos(theta) * gr, y: gy, z: Math.sin(theta) * gr }, rotationRef.current.yaw, rotationRef.current.pitch);
        if (star.z < 0.08) continue;
        context.fillStyle = `rgba(230, 236, 220, ${0.08 + star.z * 0.18})`;
        context.fillRect(globe.cx + star.x * globe.radius - 0.4, globe.cy + star.y * globe.radius - 0.4, star.z > 0.7 ? 1.2 : 0.7, star.z > 0.7 ? 1.2 : 0.7);
      }

      if (settings.guides) {
        context.save();
        context.beginPath();
        context.arc(globe.cx, globe.cy, globe.radius, 0, Math.PI * 2);
        context.clip();
        const equator: SpherePoint[] = [];
        for (let step = 0; step <= 48; step += 1) equator.push(sphereFromLonLat((step / 48) * Math.PI * 2, 0));
        context.beginPath();
        let drawing = false;
        equator.forEach((sample) => {
          const rotated = rotateSphere(sample, rotationRef.current.yaw, rotationRef.current.pitch);
          if (rotated.z < 0.06) {
            drawing = false;
            return;
          }
          const x = globe.cx + rotated.x * globe.radius;
          const y = globe.cy + rotated.y * globe.radius;
          if (!drawing) {
            context.moveTo(x, y);
            drawing = true;
            return;
          }
          context.lineTo(x, y);
        });
        context.strokeStyle = hexRgba(accent, 0.1);
        context.lineWidth = 0.7;
        context.stroke();
        context.restore();
      }

      const focusId = hoverRef.current || selectedId;
      const connected = new Set<string>();
      if (focusId) {
        connected.add(focusId);
        edges.forEach((edge) => {
          if (edge.from === focusId) connected.add(edge.to);
          if (edge.to === focusId) connected.add(edge.from);
        });
      }

      const sphereById = new Map<string, SpherePoint>();
      const animatedPoints = new Map<string, { x: number; y: number; z: number; reach: number }>();
      nodes.forEach((node, index) => {
        const sphere = rotateSphere(nodeToSphere(node), rotationRef.current.yaw, rotationRef.current.pitch);
        sphereById.set(node.id, sphere);
        const scale = globe.radius * layerRadius(node);
        const depth = 0.4 + 0.6 * Math.max(0, sphere.z);
        const amplitude = motionStrength * (node.kind === 'source' ? 2.6 : node.kind === 'person' ? 1.8 : 1.2) * depth;
        let x = globe.cx + sphere.x * scale + Math.sin(motionTime * 0.00016 + index * 2.17) * amplitude;
        let y = globe.cy + sphere.y * scale + Math.cos(motionTime * 0.00012 + index * 1.37) * amplitude * 0.72;
        let reachT = 0;
        if (cursor.active && sphere.z > -0.12) {
          const distance = Math.max(1, Math.hypot(x - cursor.x, y - cursor.y));
          if (distance < reach) {
            reachT = (1 - distance / reach) ** 1.35;
            if (!prefersReducedMotion) {
              const lift = reachT * 0.09 * depth;
              x += (x - globe.cx) * lift;
              y += (y - globe.cy) * lift;
            }
          }
        }
        animatedPoints.set(node.id, { x, y, z: sphere.z, reach: reachT });
      });
      projectedRef.current = animatedPoints;

      context.save();
      context.globalCompositeOperation = 'lighter';
      nodes.forEach((node) => {
        if (node.kind !== 'topic') return;
        const point = animatedPoints.get(node.id);
        if (!point || point.z < 0.02) return;
        const color = tunedNodeColor(node, settings.palette);
        const nebula = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, 70 + node.size * 3);
        nebula.addColorStop(0, hexRgba(color, 0.07 + point.reach * 0.08));
        nebula.addColorStop(0.45, hexRgba(color, 0.03));
        nebula.addColorStop(1, hexRgba(color, 0));
        context.fillStyle = nebula;
        context.beginPath();
        context.arc(point.x, point.y, 70 + node.size * 3, 0, Math.PI * 2);
        context.fill();
      });
      context.restore();

      if (cursor.active) {
        const palm = context.createRadialGradient(cursor.x, cursor.y, 8, cursor.x, cursor.y, reach);
        palm.addColorStop(0, hexRgba(accent, 0.07 + motionStrength * 0.04));
        palm.addColorStop(0.35, hexRgba(accent, 0.03));
        palm.addColorStop(1, hexRgba(accent, 0));
        context.fillStyle = palm;
        context.beginPath();
        context.arc(cursor.x, cursor.y, reach, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = hexRgba(accent, 0.18 + Math.sin(time * 0.003) * 0.06);
        context.lineWidth = 0.7;
        context.setLineDash([1.5, 5]);
        context.beginPath();
        context.arc(cursor.x, cursor.y, 46 + Math.sin(time * 0.0024) * 3, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
      }

      const focusPoint = focusId ? animatedPoints.get(focusId) : null;
      if (focusPoint && focusPoint.z > -0.08) {
        const focusedNode = focusId ? nodeById.get(focusId) : null;
        const focusColor = focusedNode ? tunedNodeColor(focusedNode, settings.palette) : accent;
        const well = context.createRadialGradient(focusPoint.x, focusPoint.y, 0, focusPoint.x, focusPoint.y, 110);
        well.addColorStop(0, hexRgba(focusColor, 0.16));
        well.addColorStop(0.4, hexRgba(focusColor, 0.05));
        well.addColorStop(1, hexRgba(focusColor, 0));
        context.fillStyle = well;
        context.beginPath();
        context.arc(focusPoint.x, focusPoint.y, 110, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = hexRgba(focusColor, 0.28);
        context.lineWidth = 0.7;
        context.setLineDash([2, 6]);
        context.beginPath();
        context.arc(focusPoint.x, focusPoint.y, 28 + Math.sin(time * 0.0022) * 3, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.arc(focusPoint.x, focusPoint.y, 52 + Math.sin(time * 0.0016 + 1) * 2, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
      }

      const projectSpherePoint = (point: SpherePoint) => ({
        x: globe.cx + point.x * globe.radius,
        y: globe.cy + point.y * globe.radius,
        z: point.z,
      });

      edges.forEach((edge, edgeIndex) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (!from || !to) return;
        const active = !focusId || edge.from === focusId || edge.to === focusId;
        if (focusId && !active && edgeIndex % 2 !== 0) return;
        if (!focusId && edges.length > 1800 && edge.weight < .45 && edgeIndex % 2 !== 0) return;
        const fromSphere = sphereById.get(from.id);
        const toSphere = sphereById.get(to.id);
        if (!fromSphere || !toSphere) return;
        const searchVisible = matches.has(edge.from) || matches.has(edge.to);
        const signalAlpha = edge.kind === 'affinity' ? 0.62 : 1;
        const fromColor = tunedNodeColor(from, settings.palette);
        const toColor = tunedNodeColor(to, settings.palette);
        const midZ = (fromSphere.z + toSphere.z) / 2;
        const depthFade = 0.22 + 0.78 * Math.max(0, midZ);
        if (focusId && active && searchVisible) {
          context.strokeStyle = `rgba(220, 232, 216, ${(0.1 + edge.weight * 0.18) * signalAlpha * depthFade})`;
        } else {
          const alpha = active && searchVisible ? (0.05 + edge.weight * 0.09) * signalAlpha * depthFade : 0.028 * depthFade;
          context.strokeStyle = `rgba(214, 226, 210, ${alpha})`;
        }
        if (focusId && active && searchVisible && fromSphere.z > 0.08 && toSphere.z > 0.08) {
          const a = projectSpherePoint(fromSphere);
          const b = projectSpherePoint(toSphere);
          const gradient = context.createLinearGradient(a.x, a.y, b.x, b.y);
          gradient.addColorStop(0, `${fromColor}${edge.kind === 'affinity' ? '26' : '42'}`);
          gradient.addColorStop(0.5, `rgba(220, 232, 216, ${(0.09 + edge.weight * 0.16) * signalAlpha * depthFade})`);
          gradient.addColorStop(1, `${toColor}${edge.kind === 'affinity' ? '26' : '42'}`);
          context.strokeStyle = gradient;
        }
        const fromReach = animatedPoints.get(from.id)?.reach ?? 0;
        const toReach = animatedPoints.get(to.id)?.reach ?? 0;
        const reachBoost = 1 + Math.max(fromReach, toReach) * 1.8;
        context.lineWidth = (active ? 0.4 + edge.weight * 0.7 : 0.32) * (0.7 + 0.3 * Math.max(0, midZ));
        if (edge.kind === 'affinity') context.setLineDash([1.2, 4.5]);
        context.globalAlpha = Math.min(1, (active && searchVisible ? 1 : 0.55) * reachBoost);
        context.beginPath();
        let drawing = false;
        const steps = fromSphere.z > 0.2 && toSphere.z > 0.2 ? 8 : 12;
        for (let step = 0; step <= steps; step += 1) {
          const sample = projectSpherePoint(slerpSphere(fromSphere, toSphere, step / steps));
          if (sample.z < -0.22) {
            drawing = false;
            continue;
          }
          if (!drawing) {
            context.moveTo(sample.x, sample.y);
            drawing = true;
          } else {
            context.lineTo(sample.x, sample.y);
          }
        }
        context.stroke();
        context.globalAlpha = 1;
        if (edge.kind === 'affinity') context.setLineDash([]);

        if (motionStrength > 0 && edge.kind === 'evidence' && active && searchVisible && edge.weight > 0.42 && (focusId || fromReach > 0.2 || edgeIndex % 5 === 0)) {
          const travel = (motionTime * (0.00003 + edge.weight * 0.00003) + edge.weight) % 1;
          const particle = projectSpherePoint(slerpSphere(fromSphere, toSphere, travel));
          if (particle.z > 0.02) {
            context.fillStyle = hexRgba(accent, 0.35 + Math.max(fromReach, toReach) * 0.4);
            context.beginPath();
            context.arc(particle.x, particle.y, 0.9 + Math.max(fromReach, toReach), 0, Math.PI * 2);
            context.fill();
          }
        }
      });

      const drawOrder = [...nodes].sort((first, second) =>
        (animatedPoints.get(first.id)?.z ?? 0) - (animatedPoints.get(second.id)?.z ?? 0),
      );
      drawOrder.forEach((node, index) => {
        const point = animatedPoints.get(node.id) ?? { ...getPoint(node), reach: 0 };
        const hovered = hoverRef.current === node.id;
        const selected = selectedId === node.id;
        const related = !focusId || connected.has(node.id);
        const visible = matches.has(node.id);
        const fresh = freshIdsRef.current.has(node.id);
        const depth = 0.38 + 0.62 * Math.max(0, point.z);
        const backFade = point.z < 0 ? 0.22 + 0.2 * (point.z + 1) : 1;
        const pulse = 1 + Math.sin(motionTime * 0.0008 + index * 0.7) * (fresh || node.kind === 'scout' ? 0.16 : 0.07);
        const kindScale = node.kind === 'topic' ? 0.34 : node.kind === 'person' ? 0.3 : node.kind === 'scout' ? 0.27 : 0.24;
        const radius = Math.max(1.2, node.size * kindScale) * pulse * Math.sqrt(zoomRef.current) * depth * (1 + point.reach * 0.35) + (hovered || selected || fresh ? 1.8 : 0);
        const nodeColor = tunedNodeColor(node, settings.palette);
        const inHand = point.reach > 0.18 && point.z > -0.05;

        context.globalAlpha = (related && visible ? 1 : visible ? 0.52 : 0.16) * backFade * (0.75 + point.reach * 0.4);
        const shouldGlow = point.z > -0.02 && (selected || hovered || fresh || inHand || node.kind === 'scout' || node.kind === 'topic' || node.origin === 'bridge');
        if (shouldGlow) {
          context.save();
          context.globalCompositeOperation = 'lighter';
          const glowSize = radius * (selected || hovered || inHand ? 7.2 : node.kind === 'topic' ? 6.2 : 4.6);
          const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, glowSize);
          glow.addColorStop(0, hexRgba(nodeColor, selected || hovered || fresh ? 0.55 : inHand ? 0.32 : 0.16));
          glow.addColorStop(0.35, hexRgba(nodeColor, 0.08));
          glow.addColorStop(1, hexRgba(nodeColor, 0));
          context.fillStyle = glow;
          context.beginPath();
          context.arc(point.x, point.y, glowSize, 0, Math.PI * 2);
          context.fill();
          context.restore();
        }

        if (node.kind === 'topic' || node.kind === 'scout') {
          context.strokeStyle = hexRgba(nodeColor, selected || hovered || fresh ? 0.92 : 0.55);
          context.lineWidth = node.kind === 'scout' ? 1.05 : 0.75;
          drawDiamond(context, point.x, point.y, radius * (node.kind === 'scout' ? 0.85 : 1.15));
          if (node.kind === 'scout') {
            context.fillStyle = nodeColor;
            context.fill();
          } else {
            context.stroke();
            context.fillStyle = hexRgba(nodeColor, 0.22);
            drawDiamond(context, point.x, point.y, radius * 0.42);
            context.fill();
          }
        } else if (node.kind === 'source') {
          context.fillStyle = hexRgba(nodeColor, 0.85);
          context.beginPath();
          context.arc(point.x, point.y, Math.max(1.15, radius * 0.72), 0, Math.PI * 2);
          context.fill();
        } else {
          context.fillStyle = nodeColor;
          context.beginPath();
          context.arc(point.x, point.y, Math.max(1.25, radius * 0.66), 0, Math.PI * 2);
          context.fill();
        }

        if ((node.kind === 'scout' || fresh) && point.z > 0.08) {
          context.strokeStyle = node.kind === 'scout' ? 'rgba(126, 224, 255, .45)' : hexRgba(accent, 0.45);
          context.lineWidth = 0.7;
          context.setLineDash([1.4, 3.8]);
          context.beginPath();
          context.arc(point.x, point.y, radius * 2.3, time * .00016, time * .00016 + Math.PI * 2);
          context.stroke();
          context.setLineDash([]);
        }

        if (node.origin === 'bridge' && point.z > 0.08) {
          context.strokeStyle = hexRgba(accent, 0.42);
          context.lineWidth = 0.7;
          context.setLineDash([1.5, 4]);
          context.beginPath();
          context.arc(point.x, point.y, radius * 2.4, time * .00012, time * .00012 + Math.PI * 2);
          context.stroke();
          context.setLineDash([]);
        }

        const showLabel = point.z > 0.04 && (hovered || selected || fresh || inHand || node.origin === 'bridge' || (query.trim().length > 0 && visible) ||
          (settings.labels === 'topics' && node.kind === 'topic' && node.size >= 13 && (!focusId || connected.has(node.id))) ||
          (settings.labels === 'all' && node.kind !== 'source' && (!focusId || connected.has(node.id))));
        if (showLabel) {
          const close = hovered || selected || inHand;
          context.font = `${close ? 580 : 430} ${close ? 11.5 : 9.5}px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
          context.textAlign = 'center';
          context.fillStyle = visible && related
            ? `rgba(236, 236, 232, ${0.55 + Math.max(point.reach, close ? 0.4 : 0) * 0.4})`
            : 'rgba(236,236,232,.32)';
          const label = node.kind === 'source' && !close ? node.label.slice(0, 28) : node.label;
          context.fillText(label, point.x, point.y + radius + 14);
        }
        context.globalAlpha = 1;
      });

      frameRef.current = requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frameRef.current);
        return;
      }
      lastDrawRef.current = 0;
      frameRef.current = requestAnimationFrame(draw);
    };
    document.addEventListener('visibilitychange', onVisibility);
    frameRef.current = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(frameRef.current);
    };
  }, [edges, getPoint, matches, nodeById, nodes, query, selectedId]);

  const hitTest = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let hit: StimNode | null = null;
    let closest = Number.POSITIVE_INFINITY;
    for (const node of nodes) {
      const point = projectedRef.current.get(node.id) ?? getPoint(node);
      if (point.z < -0.28) continue;
      const distance = Math.hypot(point.x - x, point.y - y);
      const threshold = Math.max(16, node.size * 1.8) * (0.72 + 0.5 * Math.max(0, point.z));
      if (distance < threshold && distance < closest) {
        hit = node;
        closest = distance;
      }
    }
    return hit;
  }, [getPoint, nodes]);

  return (
    <canvas
      ref={canvasRef}
      className="graph-canvas"
      aria-label="Interactive globe of topics, people, bookmarks, and supplemental affinities"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        cameraAnimRef.current.active = false;
        velocityRef.current = { yaw: 0, pitch: 0 };
        pointerRef.current = { x: event.clientX, y: event.clientY, down: true, moved: false };
      }}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        cursorRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true };
        const pointer = pointerRef.current;
        if (pointer.down) {
          const dx = event.clientX - pointer.x;
          const dy = event.clientY - pointer.y;
          const turn = 0.006 / Math.max(0.55, zoomRef.current);
          rotationRef.current.yaw += dx * turn;
          rotationRef.current.pitch = clampPitch(rotationRef.current.pitch + dy * turn);
          velocityRef.current.yaw = velocityRef.current.yaw * 0.38 + dx * turn * 0.62;
          velocityRef.current.pitch = velocityRef.current.pitch * 0.38 + dy * turn * 0.62;
          pointerRef.current = { x: event.clientX, y: event.clientY, down: true, moved: pointer.moved || Math.hypot(dx, dy) > 2 };
          hoverRef.current = null;
          return;
        }
        const hit = hitTest(event.clientX, event.clientY);
        hoverRef.current = hit?.id ?? null;
        event.currentTarget.style.cursor = hit ? 'pointer' : 'grab';
      }}
      onPointerUp={(event) => {
        const moved = pointerRef.current.moved;
        pointerRef.current.down = false;
        if (!moved) {
          velocityRef.current = { yaw: 0, pitch: 0 };
          onSelect(hitTest(event.clientX, event.clientY)?.id ?? null);
        }
      }}
      onPointerLeave={() => {
        pointerRef.current.down = false;
        hoverRef.current = null;
        cursorRef.current.active = false;
      }}
      onWheel={(event) => {
        event.preventDefault();
        const previousZoom = zoomRef.current;
        zoomRef.current = Math.min(2.45, Math.max(0.62, previousZoom - event.deltaY * 0.0009));
        velocityRef.current = { yaw: 0, pitch: 0 };
      }}
      onDoubleClick={() => {
        cameraAnimRef.current.active = false;
        rotationRef.current = { yaw: 0.58, pitch: -0.38 };
        velocityRef.current = { yaw: 0, pitch: 0 };
        zoomRef.current = 1;
      }}
      onKeyDown={(event) => {
        if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key) || nodes.length === 0) return;
        event.preventDefault();
        const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        const currentIndex = nodes.findIndex((node) => node.id === selectedId);
        const nextIndex = (Math.max(0, currentIndex) + direction + nodes.length) % nodes.length;
        onSelect(nodes[nextIndex].id);
      }}
      tabIndex={0}
    />
  );
}

type ConnectionState = {
  connected: boolean;
  profile?: { id: string; username: string; name: string; profileImageUrl?: string };
};

type GraphResponse = {
  nodes: StimNode[];
  edges: Edge[];
  totals: { bookmark_count: number; author_count: number; scout_count?: number; following_count?: number };
  scope?: 'overview' | 'wide';
};

type ViewMode = 'map' | 'people' | 'threads' | 'bookmarks' | 'scout' | 'neighborhood' | 'blend';

type FieldActivity = {
  kind: 'boot' | 'sync' | 'map' | 'live' | 'enrich' | 'scout';
  label: string;
  detail?: string;
  current?: number;
  total?: number;
  tick?: string;
};

type SyncStreamEvent = {
  type: 'page' | 'following' | 'done' | 'error';
  imported?: number;
  inserted?: number;
  insertedIds?: string[];
  page?: number;
  hasMore?: boolean;
  limit?: number;
  authors?: string[];
  following?: number;
  followingError?: string;
  error?: string;
};

export default function Home() {
  const [selectedId, setSelectedId] = useState<string | null>('topic:generative-interfaces');
  const [query, setQuery] = useState('');
  const [connection, setConnection] = useState<ConnectionState>({ connected: false });
  const [graphNodes, setGraphNodes] = useState<StimNode[]>(demoNodes);
  const [graphEdges, setGraphEdges] = useState<Edge[]>(demoEdges);
  const [totals, setTotals] = useState<{ bookmark_count: number; author_count: number; scout_count?: number; following_count?: number }>({
    bookmark_count: demoBookmarkSeeds.length,
    author_count: demoPeopleSeeds.length,
    scout_count: demoScoutSeeds.length,
    following_count: demoFollowedIndexes.size + demoFollowOnlySeeds.length,
  });
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [view, setView] = useState<ViewMode>('map');
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done' | 'error'>(() => {
    if (typeof window === 'undefined') return 'idle';
    const auth = new URLSearchParams(window.location.search).get('auth');
    return auth === 'invalid' || auth === 'failed' ? 'error' : 'idle';
  });
  const [syncMessage, setSyncMessage] = useState(() => {
    if (typeof window === 'undefined') return '';
    const auth = new URLSearchParams(window.location.search).get('auth');
    if (auth === 'invalid') return 'X connect did not complete. Open http://127.0.0.1:3001 — not localhost.';
    if (auth === 'failed') return 'X token exchange failed. Check X_REDIRECT_URI is http://127.0.0.1:3001/api/auth/x/callback.';
    return '';
  });
  const [pulling, setPulling] = useState(false);
  const [lastLiveAt, setLastLiveAt] = useState<number | null>(null);
  const [liveInserted, setLiveInserted] = useState(0);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [enrichState, setEnrichState] = useState<'idle' | 'enriching' | 'done' | 'error'>('idle');
  const [enrichMessage, setEnrichMessage] = useState('');
  const [scoutState, setScoutState] = useState<'idle' | 'scouting' | 'done' | 'error'>('idle');
  const [scoutMessage, setScoutMessage] = useState('');
  const [keepScouting, setKeepScouting] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [activity, setActivity] = useState<FieldActivity | null>({ kind: 'boot', label: 'Checking session' });
  const [seedGraph, setSeedGraph] = useState<GraphCapsule | null>(null);
  const [fieldScope, setFieldScope] = useState<'overview' | 'wide'>('overview');
  const [neighborhoodRootId, setNeighborhoodRootId] = useState<string | null>(null);
  const [neighborhoodDepth, setNeighborhoodDepth] = useState(2);
  const [capsuleMessage, setCapsuleMessage] = useState('');
  const [tuning, setTuning] = useState<GraphTuning>(defaultTuning);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [frameToken, setFrameToken] = useState(0);
  const [frameIds, setFrameIds] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const deferredDensity = useDeferredValue(tuning.density);
  const deferredSignalFloor = useDeferredValue(tuning.signalFloor);
  const searchRef = useRef<HTMLInputElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const fieldScopeRef = useRef(fieldScope);
  const syncingRef = useRef(false);
  const topicCount = graphNodes.filter((node) => node.kind === 'topic').length;
  const peopleCount = graphNodes.filter((node) => node.kind === 'person').length;
  const sourceCount = graphNodes.filter((node) => node.kind === 'source').length;
  const scoutCount = graphNodes.filter((node) => node.kind === 'scout').length;
  const liveState: 'off' | 'watching' | 'pulling' = mode === 'live' && connection.connected
    ? (pulling ? 'pulling' : 'watching')
    : 'off';
  const blendedGraph = useMemo(
    () => seedGraph ? combineGraphs(graphNodes, graphEdges, seedGraph) : { nodes: graphNodes, edges: graphEdges, rootId: null },
    [graphEdges, graphNodes, seedGraph],
  );
  const activeEdges = view === 'blend' && seedGraph ? blendedGraph.edges : graphEdges;
  const visibleNodes = useMemo(() => {
    if (view === 'blend' && seedGraph) return blendedGraph.nodes;
    if (view === 'neighborhood' && neighborhoodRootId) {
      const ids = collectNeighborhoodIds(neighborhoodRootId, graphNodes, graphEdges, neighborhoodDepth);
      return graphNodes.filter((node) => ids.has(node.id));
    }
    if (view === 'people') return graphNodes.filter((node) => node.kind === 'person');
    if (view === 'threads') return graphNodes.filter((node) => node.kind === 'topic');
    if (view === 'bookmarks') return graphNodes.filter((node) => node.kind === 'source' || node.kind === 'person');
    if (view === 'scout') return graphNodes.filter((node) => node.kind === 'scout' || node.kind === 'topic');
    return graphNodes;
  }, [blendedGraph.nodes, graphEdges, graphNodes, neighborhoodDepth, neighborhoodRootId, seedGraph, view]);
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((node) => node.id));
    return activeEdges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  }, [activeEdges, visibleNodes]);
  const directoryView = view === 'people' || view === 'threads' || view === 'bookmarks' || view === 'scout' || view === 'neighborhood';
  const renderedNodes = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return visibleNodes.filter((node) =>
      directoryView
      || node.id === selectedId
      || node.kind === 'topic'
      || node.origin === 'bridge'
      || (needle.length > 0 && `${node.label} ${node.note} ${node.evidence}`.toLowerCase().includes(needle))
      || stableFraction(node.id) <= deferredDensity / 100,
    );
  }, [deferredDensity, deferredQuery, directoryView, selectedId, visibleNodes]);
  const viewTuning = useMemo(() => (
    directoryView || view === 'blend' ? { ...tuning, labels: 'all' as const } : tuning
  ), [directoryView, tuning, view]);
  const roster = useMemo(() => {
    const bySize = (nodes: StimNode[]) => [...nodes].sort((first, second) => second.size - first.size);
    if (view === 'people') {
      const people = graphNodes.filter((node) => node.kind === 'person');
      const saved = bySize(people.filter((node) => !isFollowOnly(node))).slice(0, 10);
      const following = people.filter((node) => isFollowOnly(node)).slice(0, 6);
      return [...saved, ...following];
    }
    if (view === 'threads') return bySize(graphNodes.filter((node) => node.kind === 'topic')).slice(0, 14);
    if (view === 'bookmarks') return graphNodes.filter((node) => node.kind === 'source').slice(0, 16);
    if (view === 'scout') return graphNodes.filter((node) => node.kind === 'scout').slice(0, 16);
    if (view === 'neighborhood') return visibleNodes.filter((node) => node.kind !== 'source').slice(0, 16);
    if (view === 'blend') return blendedGraph.nodes.filter((node) => node.origin === 'bridge' || node.origin === 'seed').slice(0, 14);
    return [];
  }, [blendedGraph.nodes, graphNodes, view, visibleNodes]);
  const paletteHits = useMemo(() => {
    const needle = query.trim();
    const hits: PaletteHit[] = [];
    graphNodes.forEach((node) => {
      const score = Math.max(
        matchScore(node.label, needle),
        matchScore(node.note, needle) * 0.7,
        matchScore(node.evidence, needle) * 0.55,
      );
      if (needle && score <= 0) return;
      hits.push({
        id: node.id,
        label: node.label,
        detail: node.kind === 'source' ? 'bookmark' : node.kind,
        kind: node.kind,
        score: needle ? score : node.size,
      });
    });
    ([
      ['cmd:map', 'Map', 'Full field'],
      ['cmd:people', 'People', 'Authors you save'],
      ['cmd:threads', 'Threads', 'Topics'],
      ['cmd:bookmarks', 'Bookmarks', 'Saved posts'],
      ['cmd:scout', 'Scout', 'Grok finds'],
      ['cmd:neighborhood', 'Neighborhood', 'Grow from focus'],
      ['cmd:combine', 'Combine', 'Two graphs'],
      ['cmd:tune', 'Tune', 'Field controls'],
      ['cmd:rediscover', 'Rediscover', 'Jump somewhere new'],
      ['cmd:sync', 'Sync', 'Pull bookmarks from X'],
    ] as const).forEach(([id, label, detail]) => {
      const score = needle ? Math.max(matchScore(label, needle), matchScore(detail, needle) * 0.6) : 8;
      if (needle && score <= 0) return;
      hits.push({ id, label, detail, kind: 'command', score });
    });
    hits.sort((first, second) => second.score - first.score || first.label.localeCompare(second.label));
    if (!needle) {
      return [
        ...hits.filter((hit) => hit.kind === 'command'),
        ...hits.filter((hit) => hit.kind !== 'command').slice(0, 8),
      ];
    }
    return hits.slice(0, 28);
  }, [graphNodes, query]);
  const renderedNodeIds = useMemo(() => new Set(renderedNodes.map((node) => node.id)), [renderedNodes]);
  const renderedEdges = useMemo(() => visibleEdges.filter((edge) =>
    renderedNodeIds.has(edge.from) && renderedNodeIds.has(edge.to) &&
    edge.weight * 100 >= deferredSignalFloor && (tuning.affinities || edge.kind === 'evidence'),
  ), [deferredSignalFloor, renderedNodeIds, tuning.affinities, visibleEdges]);
  const nodeById = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
  const selectedConnections = useMemo(() => renderedEdges
    .filter((edge) => edge.from === selectedId || edge.to === selectedId)
    .map((edge) => ({
      edge,
      neighbor: nodeById.get(edge.from === selectedId ? edge.to : edge.from),
    }))
    .filter((item): item is { edge: Edge; neighbor: StimNode } => Boolean(item.neighbor))
    .sort((first, second) => second.edge.weight - first.edge.weight)
    .slice(0, 8), [nodeById, renderedEdges, selectedId]);
  const stageCopy = activity?.kind === 'sync'
    ? {
        eyebrow: 'SYNCING',
        title: activity.current ? `${activity.current} bookmarks in.` : 'Opening your bookmarks.',
        detail: activity.tick ?? activity.detail ?? 'Pages land as X returns them.',
      }
    : activity?.kind === 'map' || activity?.kind === 'boot'
      ? { eyebrow: 'LOADING', title: 'Mapping the field.', detail: activity.detail ?? activity.label }
      : activity?.kind === 'scout'
        ? { eyebrow: 'GROK SCOUT', title: activity.label.includes('Scouting') ? 'Searching X…' : 'New posts at the edge.', detail: activity.detail ?? 'Cyan diamonds are finds, not saves.' }
        : activity?.kind === 'enrich'
          ? { eyebrow: 'GROK', title: 'Naming the threads.', detail: activity.detail ?? activity.label }
          : view === 'blend' && seedGraph
            ? { eyebrow: 'COMBINED FIELD', title: `Your graph × ${seedGraph.name}`, detail: 'Shared nodes burn brighter. Each field keeps its own branches.' }
            : view === 'neighborhood'
              ? { eyebrow: `${neighborhoodDepth}-STEP NEIGHBORHOOD`, title: 'Stay with this thread.', detail: 'Grow outward one degree at a time.' }
              : view === 'people'
                ? { eyebrow: 'PEOPLE', title: 'Who you save and follow.', detail: 'Bookmark authors sit brighter. Accounts you follow and have not saved yet stay quieter.' }
                : view === 'threads'
                  ? { eyebrow: 'THREADS', title: 'Topics in the field.', detail: 'Diamonds are themes. Click a row to fly to one.' }
                  : view === 'bookmarks'
                    ? { eyebrow: 'BOOKMARKS', title: 'Saved posts.', detail: 'Particles around the people you keep.' }
                    : view === 'scout'
                      ? { eyebrow: 'GROK SCOUT', title: 'New posts at the edge.', detail: 'Cyan diamonds are finds, not saves.' }
                      : { eyebrow: mode === 'live' ? 'LIVE FIELD' : 'DEMO FIELD', title: 'Stuff that interests me.', detail: 'Move through the field. Names appear where you reach. Drag to spin · scroll · /' };

  const loadLiveGraph = useCallback(async (options?: { keepView?: boolean; selectId?: string | null; scope?: 'overview' | 'wide' }) => {
    const scope = options?.scope ?? fieldScopeRef.current;
    const response = await fetch(`/api/graph?scope=${scope}`, { cache: 'no-store' });
    if (!response.ok) return false;
    const data = (await response.json()) as GraphResponse;
    if (data.nodes.length === 0) return false;
    setGraphNodes(data.nodes);
    setGraphEdges(data.edges);
    setTotals(data.totals);
    setFieldScope(data.scope ?? scope);
    setMode('live');
    if (!options?.keepView) {
      setView('map');
      setSeedGraph(null);
      setNeighborhoodRootId(null);
    }
    if (options?.selectId) setSelectedId(options.selectId);
    else if (!options?.keepView) setSelectedId(data.nodes[0]?.id ?? null);
    else {
      setSelectedId((current) => (current && data.nodes.some((node) => node.id === current) ? current : data.nodes[0]?.id ?? null));
    }
    return true;
  }, []);

  const flyTo = useCallback((ids: string[]) => {
    setFrameIds(ids);
    setFrameToken((token) => token + 1);
  }, []);

  const focusNode = useCallback((id: string) => {
    setSelectedId(id);
    const nearby = collectNeighborhoodIds(id, graphNodes, graphEdges, 1);
    flyTo([...nearby]);
  }, [flyTo, graphEdges, graphNodes]);

  const markFresh = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setFreshIds((current) => new Set([...current, ...ids]));
    window.setTimeout(() => {
      setFreshIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }, 45_000);
  }, []);

  const runScout = useCallback(async () => {
    if (syncingRef.current) return;
    setScoutState('scouting');
    setScoutMessage('Grok is searching X against your topics…');
    setActivity({ kind: 'scout', label: 'Scouting X', detail: 'Grok is searching against your topics' });
    try {
      const response = await fetch('/api/scout', { method: 'POST' });
      const result = (await response.json()) as {
        found?: number;
        finds?: Array<{ postId: string }>;
        estimatedCostUsd?: number;
        zeroDataRetention?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? 'Grok scout failed.');
      await loadLiveGraph({ keepView: true });
      markFresh((result.finds ?? []).map((find) => `scout:${find.postId}`));
      setScoutState('done');
      if ((result.found ?? 0) === 0) {
        setScoutMessage(result.message ?? 'No new posts fit the map this round.');
        setActivity({ kind: 'scout', label: 'Scout quiet', detail: result.message ?? 'Nothing new this round' });
      } else {
        const retention = result.zeroDataRetention ? ' · ZDR confirmed' : '';
        setScoutMessage(`${result.found} new posts on the edge · estimated $${(result.estimatedCostUsd ?? 0).toFixed(4)}${retention}`);
        setView('scout');
        setActivity({ kind: 'scout', label: `${result.found} scouted`, detail: 'Cyan diamonds just landed' });
      }
      window.setTimeout(() => setActivity((current) => current?.kind === 'scout' ? null : current), 2200);
    } catch (error) {
      setScoutState('error');
      setScoutMessage(error instanceof Error ? error.message : 'Grok scout failed.');
      setActivity(null);
    }
  }, [loadLiveGraph, markFresh]);

  useEffect(() => {
    fieldScopeRef.current = fieldScope;
  }, [fieldScope]);

  useEffect(() => {
    syncingRef.current = syncState === 'syncing';
  }, [syncState]);

  useEffect(() => {
    const auth = new URLSearchParams(window.location.search).get('auth');
    if (auth === 'invalid' || auth === 'failed') window.history.replaceState({}, '', '/');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/x/status', { cache: 'no-store' })
      .then((response) => response.json() as Promise<ConnectionState>)
      .then(async (status) => {
        if (cancelled) return;
        setConnection(status);
        if (status.connected) {
          setActivity({ kind: 'map', label: 'Loading your field', detail: `@${status.profile?.username ?? 'you'}` });
          const loaded = await loadLiveGraph();
          if (!loaded && !cancelled) setSelectedId(null);
        }
        if (!cancelled) setActivity(null);
      })
      .catch(() => {
        if (!cancelled) setActivity(null);
      });
    return () => { cancelled = true; };
  }, [loadLiveGraph]);

  useEffect(() => {
    if (!paletteOpen) return;
    const frame = window.requestAnimationFrame(() => paletteInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [paletteOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteIndex(0);
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setPaletteIndex(0);
        setPaletteOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        setSelectedId(null);
        searchRef.current?.blur();
      }
      if (event.key.toLowerCase() === 't' && !(event.target instanceof HTMLInputElement) && !paletteOpen) {
        setTuningOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen]);

  useEffect(() => {
    let savedTuning: GraphTuning | null = null;
    try {
      const saved = window.localStorage.getItem('stimgraph:tuning');
      if (!saved) return;
      const value = JSON.parse(saved) as Partial<GraphTuning>;
      const density = Number(value.density);
      const signalFloor = Number(value.signalFloor);
      const motion = Number(value.motion);
      savedTuning = {
        density: Number.isFinite(density) ? Math.min(100, Math.max(20, density)) : defaultTuning.density,
        signalFloor: Number.isFinite(signalFloor) ? Math.min(80, Math.max(8, signalFloor)) : defaultTuning.signalFloor,
        motion: Number.isFinite(motion) ? Math.min(100, Math.max(0, motion)) : defaultTuning.motion,
        affinities: typeof value.affinities === 'boolean' ? value.affinities : defaultTuning.affinities,
        guides: typeof value.guides === 'boolean' ? value.guides : defaultTuning.guides,
        labels: value.labels === 'focus' || value.labels === 'topics' || value.labels === 'all' ? value.labels : defaultTuning.labels,
        palette: value.palette === 'spectrum' || value.palette === 'phosphor' || value.palette === 'ice' ? value.palette : defaultTuning.palette,
      };
    } catch {
      // A malformed device preference falls back to the balanced field.
    }
    if (!savedTuning) return;
    const frame = window.requestAnimationFrame(() => setTuning(savedTuning));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('stimgraph:tuning', JSON.stringify(tuning));
    } catch {
      // Device preferences are optional; the graph still works without them.
    }
  }, [tuning]);

  useEffect(() => {
    if (mode !== 'live' || !connection.connected) return;
    let cancelled = false;
    const pull = async () => {
      if (cancelled || document.hidden || syncingRef.current) return;
      setPulling(true);
      setActivity({ kind: 'live', label: 'Checking newest saves' });
      try {
        const response = await fetch('/api/bookmarks/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 15, live: true }),
        });
        const result = (await response.json()) as { inserted?: number; insertedIds?: string[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? 'Live pull failed.');
        setLastLiveAt(nowMs());
        if ((result.inserted ?? 0) > 0) {
          setLiveInserted((count) => count + (result.inserted ?? 0));
          await loadLiveGraph({ keepView: true });
          markFresh((result.insertedIds ?? []).map((id) => `bookmark:${id}`));
          setActivity({ kind: 'live', label: `${result.inserted} new saves`, detail: 'Landing on the field' });
        } else {
          setActivity({ kind: 'live', label: 'Saves are current' });
        }
      } catch {
        // Stay on the last good map; the next interval retries.
      } finally {
        if (!cancelled) {
          setPulling(false);
          window.setTimeout(() => setActivity((current) => current?.kind === 'live' ? null : current), 1600);
        }
      }
    };
    let lastPull = 0;
    const guardedPull = async () => {
      if (document.hidden || syncingRef.current) return;
      if (Date.now() - lastPull < 20_000) return;
      lastPull = Date.now();
      await pull();
    };
    const interval = window.setInterval(() => { void guardedPull(); }, 90_000);
    const startup = window.setTimeout(() => { void guardedPull(); }, 8_000);
    const onVisible = () => {
      if (!document.hidden) void guardedPull();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(startup);
      document.removeEventListener('visibilitychange', onVisible);
      setPulling(false);
    };
  }, [connection.connected, loadLiveGraph, markFresh, mode]);

  useEffect(() => {
    if (!keepScouting || mode !== 'live' || !connection.connected) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) void runScout();
    }, 12 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [connection.connected, keepScouting, mode, runScout]);

  useEffect(() => {
    if (liveState === 'off' && !lastLiveAt) return;
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [lastLiveAt, liveState]);

  const syncBookmarks = async () => {
    setSyncState('syncing');
    setSyncMessage('Opening your bookmarks…');
    setActivity({ kind: 'sync', label: 'Syncing bookmarks', current: 0, total: 600, detail: 'Waiting on X' });
    try {
      const response = await fetch('/api/bookmarks/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 600, stream: true }),
      });
      if (!response.ok) {
        const failed = (await response.json()) as { error?: string };
        throw new Error(failed.error ?? 'Sync failed.');
      }
      let imported = 0;
      let inserted = 0;
      let following = 0;
      let followingError = '';
      await readNdjson<SyncStreamEvent>(response, async (event) => {
        if (event.type === 'error') throw new Error(event.error ?? 'Sync failed.');
        imported = event.imported ?? imported;
        inserted = event.inserted ?? inserted;
        if (event.following != null) following = event.following;
        if (event.followingError) followingError = event.followingError;
        const authors = (event.authors ?? []).map((handle) => `@${handle}`).join('  ');
        if (event.type === 'following') {
          setActivity({
            kind: 'sync',
            label: event.followingError ? 'Following needs reconnect' : 'Importing who you follow',
            current: imported,
            total: event.limit ?? 600,
            detail: event.followingError ?? `${event.following ?? 0} accounts`,
          });
        } else {
          setActivity({
            kind: 'sync',
            label: 'Syncing bookmarks',
            current: imported,
            total: event.limit ?? 600,
            detail: event.type === 'done' ? 'Mapping the field' : `Page ${event.page ?? 1}`,
            tick: authors || undefined,
          });
        }
        setSyncMessage(authors
          ? `${imported} in · ${inserted} new${authors ? ` · ${authors}` : ''}`
          : `${imported} bookmarks in · ${inserted} new`);
        if ((event.insertedIds?.length ?? 0) > 0) {
          markFresh(event.insertedIds!.map((id) => `bookmark:${id}`));
        }
        const remap = event.type === 'done' || event.type === 'following' || event.page === 1 || ((event.page ?? 0) % 2 === 0 && event.hasMore);
        if (remap) {
          setActivity((current) => current ? { ...current, detail: 'Mapping the field' } : current);
          await loadLiveGraph({ keepView: true });
        }
      });
      setSyncState('done');
      setLiveInserted((count) => count + inserted);
      setLastLiveAt(nowMs());
      setSyncMessage(followingError
        ? `${imported} bookmarks mapped · ${inserted} new. ${followingError}`
        : `${imported} bookmarks mapped · ${inserted} new · ${following} following.`);
      setActivity({
        kind: 'sync',
        label: 'Field updated',
        current: imported,
        total: imported || 600,
        detail: followingError ? followingError : `${inserted} new saves · ${following} following`,
      });
      window.setTimeout(() => setActivity((current) => current?.kind === 'sync' ? null : current), 1800);
    } catch (error) {
      setSyncState('error');
      setSyncMessage(error instanceof Error ? error.message : 'Sync failed.');
      setActivity(null);
    }
  };

  const enrichBookmarks = async () => {
    setEnrichState('enriching');
    setEnrichMessage('Sending the next 40 bookmark texts and author handles to Grok…');
    setActivity({ kind: 'enrich', label: 'Naming threads', detail: 'Next 40 bookmarks → Grok' });
    try {
      const response = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 40 }),
      });
      const result = (await response.json()) as {
        analyzed?: number;
        topics?: number;
        estimatedCostUsd?: number;
        zeroDataRetention?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? 'Grok enrichment failed.');
      await loadLiveGraph({ keepView: true });
      setEnrichState('done');
      if (result.analyzed === 0) {
        setEnrichMessage(result.message ?? 'No new bookmarks need enrichment.');
        setActivity({ kind: 'enrich', label: 'Threads are current' });
      } else {
        const retention = result.zeroDataRetention ? ' · ZDR confirmed' : '';
        setEnrichMessage(`${result.analyzed ?? 0} bookmarks gained ${result.topics ?? 0} topic links · estimated $${(result.estimatedCostUsd ?? 0).toFixed(4)}${retention}`);
        setActivity({ kind: 'enrich', label: `${result.topics ?? 0} topic links`, detail: `${result.analyzed} bookmarks named` });
      }
      window.setTimeout(() => setActivity((current) => current?.kind === 'enrich' ? null : current), 2200);
    } catch (error) {
      setEnrichState('error');
      setEnrichMessage(error instanceof Error ? error.message : 'Grok enrichment failed.');
      setActivity(null);
    }
  };

  const enterView = (nextView: ViewMode) => {
    setTuningOpen(false);
    setView(nextView);
    if (nextView === 'map') {
      setSelectedId(null);
      flyTo(graphNodes.map((node) => node.id));
      return;
    }
    if (nextView === 'people') {
      const people = graphNodes.filter((node) => node.kind === 'person');
      setSelectedId(null);
      flyTo(people.map((node) => node.id));
      return;
    }
    if (nextView === 'threads') {
      const topics = graphNodes.filter((node) => node.kind === 'topic');
      setSelectedId(null);
      flyTo(topics.map((node) => node.id));
      return;
    }
    if (nextView === 'bookmarks') {
      const sources = graphNodes.filter((node) => node.kind === 'source' || node.kind === 'person');
      setSelectedId(null);
      flyTo(sources.map((node) => node.id));
      return;
    }
    if (nextView === 'scout') {
      const scouts = graphNodes.filter((node) => node.kind === 'scout' || node.kind === 'topic');
      setSelectedId(null);
      flyTo(scouts.map((node) => node.id));
      return;
    }
    if (nextView === 'blend' && seedGraph) {
      const bridges = blendedGraph.nodes.filter((node) => node.origin === 'bridge' || node.origin === 'seed');
      setSelectedId(blendedGraph.rootId ?? bridges[0]?.id ?? null);
      flyTo(bridges.map((node) => node.id));
    }
  };

  const rediscover = () => {
    if (visibleNodes.length === 0) return;
    const currentIndex = visibleNodes.findIndex((node) => node.id === selectedId);
    const offset = randomOffset(visibleNodes.length - 1);
    const next = visibleNodes[(Math.max(0, currentIndex) + offset) % visibleNodes.length];
    setSelectedId(next.id);
    flyTo([...collectNeighborhoodIds(next.id, visibleNodes, visibleEdges, 1)]);
  };

  const seedNeighborhood = () => {
    const root = selectedId ?? neighborhoodRootId ?? graphNodes.find((node) => node.kind === 'topic')?.id;
    if (!root) return;
    setTuningOpen(false);
    setNeighborhoodRootId(root);
    setNeighborhoodDepth(2);
    setView('neighborhood');
    setSelectedId(root);
    flyTo([...collectNeighborhoodIds(root, graphNodes, graphEdges, 2)]);
  };

  const applyPaletteHit = (hit: PaletteHit) => {
    setPaletteOpen(false);
    if (hit.kind === 'command') {
      if (hit.id === 'cmd:map') enterView('map');
      else if (hit.id === 'cmd:people') enterView('people');
      else if (hit.id === 'cmd:threads') enterView('threads');
      else if (hit.id === 'cmd:bookmarks') enterView('bookmarks');
      else if (hit.id === 'cmd:scout') enterView('scout');
      else if (hit.id === 'cmd:neighborhood') seedNeighborhood();
      else if (hit.id === 'cmd:combine') {
        if (seedGraph) enterView('blend');
        else loadDemoCombination();
      } else if (hit.id === 'cmd:tune') {
        setTuningOpen(true);
        flyTo(graphNodes.map((node) => node.id));
      } else if (hit.id === 'cmd:rediscover') rediscover();
      else if (hit.id === 'cmd:sync') void syncBookmarks();
      return;
    }
    if (hit.kind === 'person') setView('people');
    else if (hit.kind === 'topic') setView('threads');
    else if (hit.kind === 'source') setView('bookmarks');
    else if (hit.kind === 'scout') setView('scout');
    focusNode(hit.id);
  };

  const growNeighborhood = () => {
    const root = neighborhoodRootId ?? selectedId;
    setNeighborhoodDepth((depth) => {
      const next = Math.min(4, depth + 1);
      if (root) flyTo([...collectNeighborhoodIds(root, graphNodes, graphEdges, next)]);
      return next;
    });
  };

  const pullWiderField = async () => {
    setCapsuleMessage('Pulling more authors, bookmarks, and weak links into the field…');
    try {
      const response = await fetch('/api/graph?scope=wide', { cache: 'no-store' });
      if (!response.ok) throw new Error('The wider field could not be loaded.');
      const data = (await response.json()) as GraphResponse;
      setGraphNodes(data.nodes);
      setGraphEdges(data.edges);
      setTotals(data.totals);
      setFieldScope('wide');
      setCapsuleMessage(`${data.nodes.length} signals and ${data.edges.length} connections are now in view.`);
    } catch (error) {
      setCapsuleMessage(error instanceof Error ? error.message : 'The wider field could not be loaded.');
    }
  };

  const loadDemoCombination = () => {
    const capsule = buildDemoCapsule();
    const combined = combineGraphs(graphNodes, graphEdges, capsule);
    setSeedGraph(capsule);
    setView('blend');
    setSelectedId(combined.rootId);
    setCapsuleMessage(`Combined with ${capsule.name}.`);
    flyTo(combined.nodes.filter((node) => node.origin === 'bridge' || node.origin === 'seed').map((node) => node.id));
  };

  const clearCombination = () => {
    setSeedGraph(null);
    setCapsuleMessage('');
    setView('map');
    setSelectedId(graphNodes[0]?.id ?? null);
  };

  const exportNeighborhood = () => {
    const nonBookmarkNodes = graphNodes.filter((node) => node.kind !== 'source' && node.kind !== 'scout');
    const nonBookmarkIds = new Set(nonBookmarkNodes.map((node) => node.id));
    let rootId = selectedId && nonBookmarkIds.has(selectedId) ? selectedId : null;
    if (!rootId && selectedId) {
      const neighborEdge = graphEdges.find((edge) =>
        (edge.from === selectedId && nonBookmarkIds.has(edge.to)) ||
        (edge.to === selectedId && nonBookmarkIds.has(edge.from)));
      rootId = neighborEdge ? (neighborEdge.from === selectedId ? neighborEdge.to : neighborEdge.from) : null;
    }
    rootId ??= nonBookmarkNodes[0]?.id ?? null;
    if (!rootId) return;
    const neighborhoodIds = collectNeighborhoodIds(rootId, graphNodes, graphEdges, 2);
    const shareNodes = nonBookmarkNodes
      .filter((node) => neighborhoodIds.has(node.id))
      .slice(0, 80)
      .map((node) => ({
        ...node,
        note: 'Shared neighborhood node.',
        evidence: 'Shared structure · Bookmark text withheld',
        url: undefined,
        origin: 'seed' as const,
      }));
    const shareIds = new Set(shareNodes.map((node) => node.id));
    const capsule: GraphCapsule = {
      version: 1,
      name: mode === 'live' ? `@${connection.profile?.username ?? 'someone'}’s field` : 'A Stimgraph demo field',
      rootId,
      nodes: shareNodes,
      edges: graphEdges.filter((edge) => shareIds.has(edge.from) && shareIds.has(edge.to)).slice(0, 240),
    };
    const blob = new Blob([JSON.stringify(capsule, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stimgraph-${slug(selected?.label ?? 'neighborhood')}.stimgraph`;
    link.click();
    URL.revokeObjectURL(url);
    setCapsuleMessage(`Exported ${shareNodes.length} people and topics. Bookmark text stayed out.`);
  };

  const importNeighborhood = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const capsule = parseCapsule(JSON.parse(await file.text()) as unknown);
      if (!capsule) throw new Error('This file is not a Stimgraph neighborhood.');
      const combined = combineGraphs(graphNodes, graphEdges, capsule);
      setSeedGraph(capsule);
      setView('blend');
      setSelectedId(combined.rootId);
      setCapsuleMessage(`Combined with ${capsule.name}.`);
      flyTo(combined.nodes.filter((node) => node.origin === 'bridge' || node.origin === 'seed').map((node) => node.id));
    } catch (error) {
      setCapsuleMessage(error instanceof Error ? error.message : 'The neighborhood could not be read.');
    }
  };

  const disconnect = async () => {
    await fetch('/api/auth/x/disconnect', { method: 'POST' });
    setConnection({ connected: false });
    setGraphNodes(demoNodes);
    setGraphEdges(demoEdges);
    setTotals({
      bookmark_count: demoBookmarkSeeds.length,
      author_count: demoPeopleSeeds.length,
      scout_count: demoScoutSeeds.length,
      following_count: demoFollowedIndexes.size + demoFollowOnlySeeds.length,
    });
    setMode('demo');
    setPulling(false);
    setKeepScouting(false);
    setActivity(null);
    setFreshIds(new Set());
    setLiveInserted(0);
    setLastLiveAt(null);
    setScoutMessage('');
    setView('map');
    setSeedGraph(null);
    setFieldScope('overview');
    setNeighborhoodRootId(null);
    setCapsuleMessage('');
    setSelectedId('topic:generative-interfaces');
  };

  const deleteLocalData = async () => {
    const confirmed = window.confirm('Delete this local Stimgraph map and disconnect X? This cannot be undone.');
    if (!confirmed) return;
    const response = await fetch('/api/data', { method: 'DELETE' });
    if (!response.ok) {
      setSyncState('error');
      setSyncMessage('The local map could not be deleted.');
      return;
    }
    setSyncMessage('');
    setEnrichMessage('');
    await disconnect();
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">/</span>
          <div>
            <p className="brand">STIMGRAPH</p>
            <p className="brand-expansion">Stuff That Interests Me</p>
          </div>
        </div>

        <button className="search-box" type="button" onClick={() => { setPaletteIndex(0); setPaletteOpen(true); }} aria-label="Search the field">
          <span aria-hidden="true">⌕</span>
          <span className={query ? 'search-value' : 'search-placeholder'}>{query || 'Search the field'}</span>
          <kbd>⌘K</kbd>
        </button>

        <div className="topbar-actions">
          <span className={`demo-pill ${mode === 'live' ? 'live' : ''}`}>
            <i /> {mode === 'live'
              ? `${totals.bookmark_count} saved${liveInserted ? ` · +${liveInserted}` : ''}`
              : 'Demo field'}
          </span>
          {connection.connected ? (
            <button className="connect-button sync-button" type="button" onClick={syncBookmarks} disabled={syncState === 'syncing'}>
              {syncState === 'syncing'
                ? (activity?.kind === 'sync' && activity.current != null ? `${activity.current}/${activity.total}` : 'Syncing…')
                : `Sync @${connection.profile?.username ?? 'X'}`}
            </button>
          ) : (
            <a className="connect-button" href="/api/auth/x/start">Connect X</a>
          )}
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail" aria-label="Graph navigation">
          <nav>
            <button className={`rail-item ${view === 'map' && !tuningOpen ? 'active' : ''}`} type="button" onClick={() => enterView('map')}><span>⌘</span>Map</button>
            <button className={`rail-item ${view === 'people' ? 'active' : ''}`} type="button" onClick={() => enterView('people')}><span>◎</span>People</button>
            <button className={`rail-item ${view === 'threads' ? 'active' : ''}`} type="button" onClick={() => enterView('threads')}><span>↝</span>Threads</button>
            <button className={`rail-item ${view === 'bookmarks' ? 'active' : ''}`} type="button" onClick={() => enterView('bookmarks')}><span>✦</span>Bookmarks</button>
            <button className={`rail-item ${view === 'scout' ? 'active' : ''}`} type="button" onClick={() => enterView('scout')}><span>⬡</span>Scout</button>
            <button className={`rail-item ${view === 'neighborhood' ? 'active' : ''}`} type="button" onClick={seedNeighborhood}><span>⊙</span>Neighborhood</button>
            <button className={`rail-item ${view === 'blend' ? 'active' : ''}`} type="button" onClick={() => seedGraph ? enterView('blend') : loadDemoCombination()}><span>⌁</span>Combine</button>
            <button className={`rail-item ${tuningOpen ? 'active' : ''}`} type="button" onClick={() => { setTuningOpen((open) => !open); flyTo(graphNodes.map((node) => node.id)); }}><span>◌</span>Tune</button>
            <button className="rail-item" type="button" onClick={rediscover}><span>◷</span>Rediscover</button>
          </nav>

          <div className="rail-summary">
            <p className="eyebrow">{fieldScope === 'wide' ? 'WIDE FIELD' : 'IN THE FIELD'}</p>
            <dl>
              <div><dt>Topics</dt><dd>{topicCount}</dd></div>
              <div><dt>People</dt><dd>{peopleCount}</dd></div>
              <div><dt>Following</dt><dd>{totals.following_count ?? graphNodes.filter((node) => node.followed).length}</dd></div>
              <div><dt>Bookmarks</dt><dd>{sourceCount}</dd></div>
              <div><dt>Scouted</dt><dd>{scoutCount}</dd></div>
            </dl>
          </div>

          <button className="permissions-link" type="button" onClick={() => setSelectedId(null)}>
            <span>◇</span>
            <span><b>Read-only by design</b><small>See what Stimgraph can access</small></span>
          </button>
        </aside>

        <div className={`graph-stage palette-${tuning.palette}`}>
          <div className={`stage-heading ${tuning.guides ? '' : 'guide-hidden'}`} aria-hidden={!tuning.guides}>
            <p className="eyebrow">{stageCopy.eyebrow}</p>
            <h1>{stageCopy.title}</h1>
            <p>{stageCopy.detail}</p>
          </div>
          <div className={`field-readout ${activity ? 'busy' : ''}`} aria-live="polite">
            {activity ? (
              <>
                <span>{activity.label}{activity.current != null ? `  ${activity.current}/${activity.total}` : ''}</span>
                {activity.tick ? <><i /><span>{activity.tick}</span></> : activity.detail ? <><i /><span>{activity.detail}</span></> : null}
              </>
            ) : (
              <>
                <span>{renderedNodes.length} signals</span>
                <i />
                <span>{renderedEdges.length} connections</span>
              </>
            )}
          </div>
          <div className={`activity-bar ${activity ? 'on' : ''} ${activity && activity.current == null ? 'indeterminate' : ''} ${activity?.kind ?? ''}`} aria-hidden={!activity}>
            <i style={activity?.current != null && activity.total
              ? { width: `${Math.min(100, (activity.current / Math.max(1, activity.total)) * 100)}%` }
              : undefined}
            />
          </div>
          <GraphCanvas nodes={renderedNodes} edges={renderedEdges} selectedId={selectedId} query={deferredQuery} tuning={viewTuning} freshIds={freshIds} busy={Boolean(activity)} frameToken={frameToken} frameIds={frameIds} onSelect={(id) => id ? focusNode(id) : setSelectedId(null)} />
          <div className={`legend ${tuning.guides ? '' : 'guide-hidden'}`} aria-label="Graph legend" aria-hidden={!tuning.guides}>
            {view === 'blend' && seedGraph ? (
              <>
                <span><i className="local-dot" />Your field</span>
                <span><i className="seed-dot" />{seedGraph.name}</span>
                <span><i className="bridge-dot" />Shared bridge</span>
              </>
            ) : (
              <>
                <span><i className="topic-dot" />Topic</span>
                <span><i className="person-dot" />Person</span>
                <span><i className="follow-dot" />Following</span>
                <span><i className="source-dot" />Bookmark</span>
                <span><i className="scout-dot" />Scout</span>
                <span className="affinity-key"><i />Affinity</span>
              </>
            )}
          </div>

          <section className={`tuning-deck ${tuningOpen ? 'open' : ''}`} aria-label="Graph controls" aria-hidden={!tuningOpen}>
            <div className="tuning-head">
              <div><p className="eyebrow">FIELD CONTROL</p><h2>Tune the graph</h2></div>
              <button type="button" onClick={() => setTuningOpen(false)} aria-label="Close graph controls">×</button>
            </div>
            <div className="preset-row">
              {tuningPresets.map((preset) => (
                <button type="button" key={preset.name} onClick={() => setTuning({ ...preset.value })}>{preset.name}</button>
              ))}
            </div>
            <label className="tuning-slider">
              <span><b>Particles</b><output>{tuning.density}%</output></span>
              <input type="range" min="20" max="100" value={tuning.density} onChange={(event) => setTuning((current) => ({ ...current, density: Number(event.target.value) }))} />
            </label>
            <label className="tuning-slider">
              <span><b>Weakest link</b><output>{tuning.signalFloor}%</output></span>
              <input type="range" min="8" max="80" value={tuning.signalFloor} onChange={(event) => setTuning((current) => ({ ...current, signalFloor: Number(event.target.value) }))} />
            </label>
            <label className="tuning-slider">
              <span><b>Motion</b><output>{tuning.motion}%</output></span>
              <input type="range" min="0" max="100" value={tuning.motion} onChange={(event) => setTuning((current) => ({ ...current, motion: Number(event.target.value) }))} />
            </label>
            <div className="tuning-section">
              <span>CONNECTIONS</span>
              <button className={`tuning-toggle ${tuning.affinities ? 'active' : ''}`} type="button" aria-pressed={tuning.affinities} onClick={() => setTuning((current) => ({ ...current, affinities: !current.affinities }))}>
                <i /> Dotted patterns
              </button>
              <button className={`tuning-toggle ${tuning.guides ? 'active' : ''}`} type="button" aria-pressed={tuning.guides} onClick={() => setTuning((current) => ({ ...current, guides: !current.guides }))}>
                <i /> Headings and legend
              </button>
            </div>
            <div className="tuning-section">
              <span>LABELS</span>
              <div className="segmented-control">
                {(['focus', 'topics', 'all'] as const).map((labelMode) => (
                  <button className={tuning.labels === labelMode ? 'active' : ''} type="button" key={labelMode} onClick={() => setTuning((current) => ({ ...current, labels: labelMode }))}>
                    {labelMode === 'focus' ? 'Focus' : labelMode === 'topics' ? 'Topics' : 'People too'}
                  </button>
                ))}
              </div>
            </div>
            <div className="tuning-section">
              <span>COLOR</span>
              <div className="palette-control">
                {(['spectrum', 'phosphor', 'ice'] as const).map((palette) => (
                  <button className={`${palette} ${tuning.palette === palette ? 'active' : ''}`} type="button" key={palette} onClick={() => setTuning((current) => ({ ...current, palette }))} aria-label={`${palette} colors`}>
                    <i /><b>{palette}</b>
                  </button>
                ))}
              </div>
            </div>
            <div className="tuning-foot">
              <button type="button" onClick={() => setTuning({ ...defaultTuning })}>Reset</button>
              <span><kbd>T</kbd> toggle controls</span>
            </div>
          </section>

          <aside className={`inspector ${selected || view !== 'map' ? 'has-selection' : ''}`} aria-live="polite">
          {selected ? (
            <>
              <div className="inspector-topline">
                <div className="focus-badges">
                  <span className={`kind-badge ${selected.kind}`}>{selected.kind === 'source' ? 'bookmark' : selected.kind === 'scout' ? 'scout' : selected.kind}</span>
                  {selected.origin ? <span className={`origin-badge ${selected.origin}`}>{selected.origin === 'bridge' ? 'shared' : selected.origin}</span> : null}
                  {selected.followed ? <span className="origin-badge following">following</span> : null}
                </div>
                <button type="button" onClick={() => setSelectedId(null)} aria-label="Close details">×</button>
              </div>
              <div className="selected-orb" style={{ '--orb-color': tunedNodeColor(selected, tuning.palette) } as React.CSSProperties} />
              <h2>{selected.label}</h2>
              <p className="inspector-note">{selected.note}</p>
              {selected.url ? <a className="node-link" href={selected.url} target="_blank" rel="noreferrer">Open on X ↗</a> : null}

              <div className="focus-evidence">
                <span>WHY IT APPEARS</span>
                <strong>{selected.evidence}</strong>
              </div>

              <section className="focus-orbit" aria-label="Nearby signals">
                <p className="eyebrow">NEARBY SIGNALS</p>
                <div className="orbit-field">
                  <div className="orbit-ring ring-one" />
                  <div className="orbit-ring ring-two" />
                  <div className="orbit-core" style={{ '--orb-color': tunedNodeColor(selected, tuning.palette) } as React.CSSProperties}>
                    <i />
                    <span>focus</span>
                  </div>
                  {selectedConnections.map(({ edge, neighbor }, index) => {
                    const angle = -90 + (360 / Math.max(1, selectedConnections.length)) * index;
                    const radians = angle * Math.PI / 180;
                    const left = 50 + Math.cos(radians) * 38;
                    const top = 51 + Math.sin(radians) * 38;
                    return (
                      <span className="orbit-item" key={`${edge.from}:${edge.to}`}>
                        <i
                          className={`orbit-spoke ${edge.kind}`}
                          style={{ '--angle': `${angle}deg`, '--strength': edge.weight } as React.CSSProperties}
                        />
                        <button
                          className={`orbit-node ${neighbor.kind}`}
                          style={{ left: `${left}%`, top: `${top}%`, '--node-color': tunedNodeColor(neighbor, tuning.palette) } as React.CSSProperties}
                          type="button"
                          onClick={() => focusNode(neighbor.id)}
                          aria-label={`${neighbor.label}, ${edge.kind === 'affinity' ? 'shared pattern' : `${Math.round(edge.weight * 100)} percent evidence`}`}
                        >
                          <i />
                          <b>{neighbor.label}</b>
                        </button>
                      </span>
                    );
                  })}
                </div>
              </section>

              <div className="focus-actions">
                <button type="button" onClick={seedNeighborhood}>Grow from here</button>
                {view === 'neighborhood' && neighborhoodDepth < 4 ? <button type="button" onClick={growNeighborhood}>+ one step</button> : null}
                <button type="button" onClick={exportNeighborhood}>Export neighborhood</button>
                <button type="button" onClick={() => importRef.current?.click()}>Combine a graph</button>
                {mode === 'live' && fieldScope === 'overview' ? <button type="button" onClick={pullWiderField}>Pull wider field</button> : null}
                {seedGraph ? <button type="button" onClick={clearCombination}>Separate graphs</button> : null}
              </div>
              {capsuleMessage ? <p className="capsule-message">{capsuleMessage}</p> : null}
            </>
          ) : view !== 'map' ? (
            <div className="view-panel">
              <p className="eyebrow">{view === 'people' ? 'PEOPLE' : view === 'threads' ? 'THREADS' : view === 'bookmarks' ? 'BOOKMARKS' : view === 'scout' ? 'GROK SCOUT' : view === 'neighborhood' ? 'NEIGHBORHOOD' : 'COMBINED FIELD'}</p>
              <h2>{view === 'people' ? 'Who you save and follow.' : view === 'threads' ? 'Named threads.' : view === 'bookmarks' ? 'Saved posts.' : view === 'scout' ? 'Finds at the edge.' : view === 'neighborhood' ? 'This pocket of the field.' : seedGraph ? `Your graph × ${seedGraph.name}` : 'Meet another field.'}</h2>
              <p className="inspector-note">{view === 'people' ? 'Bookmark authors first, then quieter accounts you follow. Click a row to fly the camera to them.' : view === 'threads' ? 'Themes Grok or hashtags attached to saved posts. Click a row to sit on that diamond.' : view === 'bookmarks' ? 'Recent saved posts. Open one to see why it is on the map.' : view === 'scout' ? 'Cyan diamonds are suggestions, not bookmarks. Scout searches X against your topics.' : view === 'neighborhood' ? 'Two steps out from the focus node. Grow or export this pocket.' : 'Shared people and topics burn as bridges. Bookmark text stays out of the file.'}</p>
              {view === 'scout' && connection.connected && mode === 'live' ? (
                <div className="view-actions">
                  <button className="ai-button scout" type="button" onClick={() => void runScout()} disabled={scoutState === 'scouting'}>
                    {scoutState === 'scouting' ? 'Scouting X…' : 'Scout new content'}
                  </button>
                  {scoutMessage ? <p className={`sync-message ${scoutState}`}>{scoutMessage}</p> : null}
                </div>
              ) : null}
              {view === 'threads' && connection.connected && mode === 'live' ? (
                <div className="view-actions">
                  <button className="ai-button" type="button" onClick={enrichBookmarks} disabled={enrichState === 'enriching'}>
                    {enrichState === 'enriching' ? 'Finding threads…' : 'Analyze next 40 with Grok'}
                  </button>
                  {enrichMessage ? <p className={`sync-message ${enrichState}`}>{enrichMessage}</p> : null}
                </div>
              ) : null}
              {view === 'neighborhood' ? (
                <div className="view-actions">
                  {neighborhoodDepth < 4 ? <button className="wide-connect" type="button" onClick={growNeighborhood}>Grow one more step</button> : null}
                  <button className="wide-connect" type="button" onClick={exportNeighborhood}>Export neighborhood</button>
                </div>
              ) : null}
              {view === 'blend' ? (
                <div className="view-actions">
                  <button className="wide-connect" type="button" onClick={() => importRef.current?.click()}>Open .stimgraph file</button>
                  {seedGraph ? <button className="wide-connect" type="button" onClick={clearCombination}>Separate graphs</button> : null}
                </div>
              ) : null}
              <div className="connections-list">
                {roster.length === 0 ? <p className="capsule-message">Nothing in this slice yet.</p> : roster.map((node) => (
                  <button type="button" key={node.id} onClick={() => focusNode(node.id)}>
                    <i style={{ background: tunedNodeColor(node, tuning.palette) }} />
                    <span>{node.label}</span>
                    <b>{node.kind === 'source' ? 'bookmark' : isFollowOnly(node) ? 'following' : node.kind}</b>
                  </button>
                ))}
              </div>
              {capsuleMessage ? <p className="capsule-message">{capsuleMessage}</p> : null}
            </div>
          ) : (
            <div className="permissions-panel">
              <span className="permission-icon">◇</span>
              <p className="eyebrow">{connection.connected ? 'X CONNECTED' : 'PERMISSIONS PREVIEW'}</p>
              <h2>{connection.connected ? `Ready, @${connection.profile?.username}.` : 'You choose what enters the map.'}</h2>
              <p>{connection.connected
                ? 'Your token is encrypted in an HTTP-only browser cookie. Full import still waits for Sync. Sync pulls bookmarks and who you follow. After that, this tab polls the newest 15 bookmarks every 90 seconds while it is visible. X has no bookmark webhook on this API.'
                : 'Stimgraph asks X for five read-only permissions. It cannot post, like, follow, or change your bookmarks.'}</p>
              <ul>
                <li><b>Bookmarks</b><span>Read saved posts only when you press Sync</span></li>
                <li><b>Following</b><span>Read accounts you follow, as quieter people on the globe</span></li>
                <li><b>Posts</b><span>Read the content you saved</span></li>
                <li><b>Profiles</b><span>Name the people in your map</span></li>
                <li><b>Offline access</b><span>Refresh when you ask it to sync</span></li>
              </ul>
              {connection.connected ? (
                <button className="wide-connect" type="button" onClick={syncBookmarks} disabled={syncState === 'syncing'}>
                  {syncState === 'syncing'
                    ? (activity?.kind === 'sync' && activity.current != null
                      ? `Mapping ${activity.current} of ${activity.total}…`
                      : 'Opening bookmarks…')
                    : 'Sync bookmarks and following'}
                </button>
              ) : (
                <a className="wide-connect" href="/api/auth/x/start">Review and connect X</a>
              )}
              {syncMessage ? <p className={`sync-message ${syncState}`}>{syncMessage}</p> : null}
              {syncMessage.includes('Reconnect X') ? <a className="node-link" href="/api/auth/x/start">Reconnect X to grant follows.read ↗</a> : null}
              <small>A 600-bookmark sync is about $0.60 at <a href="https://docs.x.com/x-api/getting-started/pricing" target="_blank" rel="noreferrer">X’s current owned-read rate</a>. Bookmark text stays local until you separately approve AI enrichment.</small>

              {connection.connected && mode === 'live' ? (
                <section className="ai-consent-card" aria-label="Optional Grok enrichment">
                  <p className="eyebrow">SEPARATE AI CONSENT</p>
                  <h3>Let Grok name the threads?</h3>
                  <p>Only this click sends the next 40 bookmark texts and author handles to xAI. Your X token, profile token, and existing graph are never sent.</p>
                  <p>Requests use <code>store: false</code>. xAI says API content may still be retained for abuse review for up to 30 days unless your team has Zero Data Retention enabled; it is not used for training without permission.</p>
                  <button className="ai-button" type="button" onClick={enrichBookmarks} disabled={enrichState === 'enriching'}>
                    {enrichState === 'enriching' ? 'Finding threads…' : 'Analyze next 40 with Grok'}
                  </button>
                  {enrichMessage ? <p className={`sync-message ${enrichState}`}>{enrichMessage}</p> : null}
                  <small><a href="https://docs.x.ai/developers/pricing" target="_blank" rel="noreferrer">Current Grok rates</a>: $2/M input tokens and $6/M output tokens. A small batch is normally cents; exact usage is reported after each run.</small>
                </section>
              ) : null}

              {connection.connected && mode === 'live' ? (
                <section className="ai-consent-card" aria-label="Grok scout">
                  <p className="eyebrow">GROK SCOUT</p>
                  <h3>Hunt for posts you have not saved yet.</h3>
                  <p>Grok searches X with <code>x_search</code> against your top topics, frequent authors, and accounts you follow. It does not send bookmark text or your X token.</p>
                  <button className="ai-button scout" type="button" onClick={() => void runScout()} disabled={scoutState === 'scouting'}>
                    {scoutState === 'scouting' ? 'Scouting X…' : 'Scout new content'}
                  </button>
                  <button
                    className={`tuning-toggle ${keepScouting ? 'active' : ''}`}
                    type="button"
                    aria-pressed={keepScouting}
                    onClick={() => setKeepScouting((value) => !value)}
                    style={{ marginTop: 12 }}
                  >
                    <i /> Keep scouting while this tab is open
                  </button>
                  {scoutMessage ? <p className={`sync-message ${scoutState}`}>{scoutMessage}</p> : null}
                  <small>Each run uses X search plus a Grok response. Repeat about every 12 minutes if keep-scouting is on. Cyan diamonds are suggestions, not bookmarks.</small>
                </section>
              ) : null}

              {connection.connected ? (
                <section className="data-controls" aria-label="Local data controls">
                  <p className="eyebrow">DATA CONTROLS</p>
                  <button type="button" onClick={disconnect}>Disconnect browser session</button>
                  <button className="danger-link" type="button" onClick={deleteLocalData}>Delete local map + disconnect</button>
                  <small>Disconnecting leaves your local map in place. Deleting removes it from this app. Revoke the app itself from X account settings if you also want to withdraw X consent.</small>
                </section>
              ) : null}

              <section className="sharing-card" aria-label="Combine graphs">
                <p className="eyebrow">SEED A NEIGHBORHOOD</p>
                <h3>See where two graphs meet.</h3>
                <p>Export a neighborhood and send the .stimgraph file to someone else. It contains people, topics, and connection weights. Bookmark text stays out.</p>
                <div>
                  <button type="button" onClick={loadDemoCombination}>Try a second graph</button>
                  <button type="button" onClick={() => importRef.current?.click()}>Open .stimgraph file</button>
                </div>
                {capsuleMessage ? <p className="capsule-message">{capsuleMessage}</p> : null}
              </section>
            </div>
          )}
          <input ref={importRef} className="capsule-input" type="file" accept=".stimgraph,application/json" onChange={importNeighborhood} />
          <footer className="inspiration-credit">
            Interaction inspiration: <a href="https://x.com/poetengineer__/status/1821654144958202077" target="_blank" rel="noreferrer">Kat ⊷ the Poet Engineer’s gestural latent-space work</a>. Stimgraph’s design and implementation are original.
          </footer>
          </aside>
        </div>
      </section>
      {paletteOpen ? (
        <div className="palette-back" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
          <div className="palette" role="dialog" aria-label="Search the field" onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setPaletteIndex((index) => Math.min(paletteHits.length - 1, index + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setPaletteIndex((index) => Math.max(0, index - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const hit = paletteHits[Math.min(paletteIndex, paletteHits.length - 1)];
              if (hit) applyPaletteHit(hit);
            }
          }}
          >
            <label className="palette-input">
              <span aria-hidden="true">⌕</span>
              <input
                ref={paletteInputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPaletteIndex(0); }}
                placeholder="rev, a person, a topic…"
                aria-label="Filter topics, people, and posts"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd>esc</kbd>
            </label>
            <div className="palette-list">
              {paletteHits.length === 0 ? (
                <p className="palette-empty">Nothing matches “{query.trim()}”.</p>
              ) : paletteHits.map((hit, index) => (
                <button
                  type="button"
                  key={hit.id}
                  className={`palette-row ${index === paletteIndex ? 'active' : ''}`}
                  onMouseEnter={() => setPaletteIndex(index)}
                  onClick={() => applyPaletteHit(hit)}
                >
                  <i className={`palette-kind ${hit.kind}`} />
                  <span>{hit.label}</span>
                  <b>{hit.detail}</b>
                </button>
              ))}
            </div>
            <div className="palette-foot">
              <span>↑↓ move</span>
              <span>enter open</span>
              <span>esc close</span>
              <span className="spacer" />
              <span>{paletteHits.length} hits</span>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="status-bar">
        <span>
          {liveState === 'off' ? <i className="idle-dot" /> : <i className="live-dot" />}
          {activity?.kind === 'sync' ? `sync ${activity.current ?? 0}/${activity.total ?? 600}`
            : liveState === 'off' ? 'demo'
              : liveState === 'pulling' ? 'pulling bookmarks'
                : 'live poll 90s'}
        </span>
        <span><b>{totals.bookmark_count}</b> saved</span>
        <span><b>{totals.following_count ?? 0}</b> following</span>
        <span className="scout-count"><b>{totals.scout_count ?? scoutCount}</b> scouted</span>
        <span>{liveInserted ? `+${liveInserted} this session` : 'waiting for new saves'}</span>
        <span>{lastLiveAt ? `last pull ${Math.max(0, Math.round((clock - lastLiveAt) / 1000))}s` : 'no pull yet'}</span>
        <span className="spacer" />
        <span>{tuning.palette}</span>
        <span>{renderedNodes.length} pts · {renderedEdges.length} edges</span>
        <span>{keepScouting ? 'scout watch on' : scoutState === 'scouting' ? 'scouting' : 'scout idle'}</span>
      </footer>
    </main>
  );
}
