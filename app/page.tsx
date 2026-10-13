'use client';

import { lazy, memo, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parseCapsule, type GraphCapsule } from '@/lib/capsule';
import {
  SELF_NODE_ID,
  buildFollowsEdges,
  collectNeighborhoodIds,
  isFollowOnlyPerson,
  isSelfId,
  rankSearchHits,
  withSearchLabel,
  type GraphEdge,
} from '@/lib/graph-model';
import { readNdjson } from '@/lib/read-ndjson';
import { BookmarkTable } from './bookmark-table';
// Heavier visualizers load on demand so the default table view paints fast.
const ExploreGraph = lazy(() => import('./explore-graph').then((m) => ({ default: m.ExploreGraph })));
const TrajectoryWorkbench = lazy(() => import('./trajectory-workbench').then((m) => ({ default: m.TrajectoryWorkbench })));
import { buildExploreIndex, connectionReason, exploreConnections, pruneExploreTrail, visitExploreTrail, type ExploreOrientation, type ExploreTrail } from '@/lib/explore-model';
import type { FeedProbe } from '@/lib/rss-probe';

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
  self?: boolean;
  searchLabel?: string;
};

type Edge = GraphEdge;

type GraphTuning = {
  density: number;
  signalFloor: number;
  motion: number;
  affinities: boolean;
  follows: boolean;
  guides: boolean;
  labels: 'focus' | 'topics' | 'all';
  palette: 'spectrum' | 'phosphor' | 'ice';
};

const defaultTuning: GraphTuning = {
  density: 68,
  signalFloor: 22,
  motion: 24,
  affinities: true,
  follows: true,
  guides: true,
  labels: 'topics',
  palette: 'phosphor',
};

function readStoredTuning(): GraphTuning {
  if (typeof window === 'undefined') return defaultTuning;
  try {
    const saved = window.localStorage.getItem('stimgraph:tuning');
    if (!saved) return defaultTuning;
    const value = JSON.parse(saved) as Partial<GraphTuning>;
    const density = Number(value.density);
    const signalFloor = Number(value.signalFloor);
    const motion = Number(value.motion);
    return {
      density: Number.isFinite(density) ? Math.min(100, Math.max(20, density)) : defaultTuning.density,
      signalFloor: Number.isFinite(signalFloor) ? Math.min(80, Math.max(8, signalFloor)) : defaultTuning.signalFloor,
      motion: Number.isFinite(motion) ? Math.min(100, Math.max(0, motion)) : defaultTuning.motion,
      affinities: typeof value.affinities === 'boolean' ? value.affinities : defaultTuning.affinities,
      follows: typeof value.follows === 'boolean' ? value.follows : defaultTuning.follows,
      guides: typeof value.guides === 'boolean' ? value.guides : defaultTuning.guides,
      labels: value.labels === 'focus' || value.labels === 'topics' || value.labels === 'all' ? value.labels : defaultTuning.labels,
      palette: value.palette === 'spectrum' || value.palette === 'phosphor' || value.palette === 'ice' ? value.palette : defaultTuning.palette,
    };
  } catch {
    return defaultTuning;
  }
}

const tuningPresets: Array<{ name: string; value: GraphTuning }> = [
  { name: 'Quiet', value: { density: 42, signalFloor: 48, motion: 18, affinities: false, follows: true, guides: false, labels: 'focus', palette: 'ice' } },
  { name: 'Balanced', value: defaultTuning },
  { name: 'Charged', value: { density: 100, signalFloor: 12, motion: 86, affinities: true, follows: true, guides: true, labels: 'all', palette: 'spectrum' } },
];

function stableFraction(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

type ThemeName = 'dark' | 'light';

function isFollowOnly(node: StimNode) {
  return isFollowOnlyPerson(node.kind, node.followed, node.evidence, node.id);
}

function isSelf(node: StimNode) {
  return Boolean(node.self) || isSelfId(node.id);
}

function darkenHex(hex: string, amount: number) {
  const value = hex.replace('#', '');
  if (value.length < 6) return hex;
  const mix = (channel: string) => Math.max(0, Math.round(Number.parseInt(channel, 16) * (1 - amount))).toString(16).padStart(2, '0');
  return `#${mix(value.slice(0, 2))}${mix(value.slice(2, 4))}${mix(value.slice(4, 6))}`;
}

function paletteLabel(palette: GraphTuning['palette']) {
  if (palette === 'phosphor') return 'void';
  return palette;
}

function tunedNodeColor(node: StimNode, palette: GraphTuning['palette'], theme: ThemeName = 'dark') {
  if (node.kind === 'scout') {
    if (palette === 'phosphor') return theme === 'light' ? '#3a4a56' : '#9aa8b4';
    return theme === 'light' ? '#0a6a82' : '#7ee0ff';
  }
  if (node.origin === 'bridge') return theme === 'light' ? '#111111' : '#f2f2f0';
  const followOnly = isFollowOnly(node);
  if (palette === 'phosphor') {
    if (node.kind === 'topic') return theme === 'light' ? '#111111' : '#f2f2f0';
    if (followOnly) return theme === 'light' ? '#6a6a66' : '#7a7a76';
    if (node.kind === 'person') return theme === 'light' ? '#0a0a0a' : '#f2f2f0';
    return theme === 'light' ? '#5a5a56' : '#6a6a66';
  }
  if (palette === 'ice') {
    if (node.kind === 'topic') return theme === 'light' ? '#0a6a82' : '#7ee0ff';
    if (followOnly) return theme === 'light' ? '#3d5c68' : '#7d93a0';
    if (node.kind === 'person') return theme === 'light' ? '#142028' : '#e8f7ff';
    return theme === 'light' ? '#4a5a62' : '#718892';
  }
  return theme === 'light' ? darkenHex(node.color, 0.38) : node.color;
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
  if (value.length < 6) return `rgba(220, 220, 216, ${alpha})`;
  return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

function layerRadius(node: StimNode) {
  if (isSelf(node)) return 0.58;
  if (node.kind === 'topic') return 0.76;
  if (node.kind === 'scout') return 1.14;
  if (node.kind === 'source') return 1.05;
  if (isFollowOnly(node)) return 1.08;
  return 0.94;
}

const demoTopicSeeds = [
  ['Generative interfaces', '#f2f2f0', 'Interfaces that make abstract systems tangible, spatial, and responsive.'],
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

function randomOffset(span: number) {
  return 1 + Math.floor(Math.random() * Math.max(1, span));
}

type GuideStop = { id: string; beat: string };

const PALETTE_COMMANDS = [
  { id: 'cmd:explore', label: 'Explore', detail: 'Follow connections from your bookmarks' },
  { id: 'cmd:guide', label: 'Guide me', detail: 'Walk the strongest nodes' },
  { id: 'cmd:keys', label: 'Keys', detail: 'Keyboard shortcuts' },
  { id: 'cmd:map', label: 'Map', detail: 'Whole map' },
  { id: 'cmd:people', label: 'People', detail: 'Authors you save' },
  { id: 'cmd:threads', label: 'Topics', detail: 'Topics' },
  { id: 'cmd:bookmarks', label: 'Bookmarks', detail: 'Saved posts' },
  { id: 'cmd:scout', label: 'Scout', detail: 'Suggested posts' },
  { id: 'cmd:neighborhood', label: 'Neighborhood', detail: 'Grow from focus' },
  { id: 'cmd:combine', label: 'Combine', detail: 'Two graphs' },
  { id: 'cmd:tune', label: 'Tune', detail: 'Graph controls' },
  { id: 'cmd:feeds', label: 'Feeds', detail: 'RSS on linked sites' },
  { id: 'cmd:log', label: 'Log', detail: 'What just happened' },
  { id: 'cmd:share', label: 'Copy link', detail: 'Send this map' },
  { id: 'cmd:rediscover', label: 'Rediscover', detail: 'Jump somewhere new' },
  { id: 'cmd:sync', label: 'Sync', detail: 'Pull bookmarks from X' },
] as const;

function buildGuideStops(nodes: StimNode[], edges: Edge[]): GuideStop[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const topics = nodes.filter((node) => node.kind === 'topic').sort((first, second) => second.size - first.size);
  const people = nodes.filter((node) => node.kind === 'person' && !isFollowOnly(node) && !isSelf(node)).sort((first, second) => second.size - first.size);
  const bridges = nodes.filter((node) => node.origin === 'bridge');
  const scouts = nodes.filter((node) => node.kind === 'scout');
  const stops: GuideStop[] = [];
  const used = new Set<string>();
  const add = (id: string | undefined, beat: string) => {
    if (!id || used.has(id) || !byId.has(id) || !beat) return;
    used.add(id);
    stops.push({ id, beat });
  };
  const neighbors = (id: string) => edges
    .filter((edge) => edge.from === id || edge.to === id)
    .map((edge) => (edge.from === id ? edge.to : edge.from));

  add(topics[0]?.id, topics[0] ? `${topics[0].label} is the densest topic here.` : '');
  if (topics[0]) {
    const linked = people.find((person) => neighbors(topics[0].id).includes(person.id));
    add(linked?.id, linked ? `Saves often sit near ${topics[0].label}.` : '');
  }
  add(topics[1]?.id, topics[1] ? `${topics[1].label} is the next cluster.` : '');
  add(people[0]?.id, people[0] ? 'The author you save most.' : '');
  add(bridges[0]?.id, 'This node appears on both maps.');
  add(scouts[0]?.id, 'A suggestion, not a bookmark.');
  add(topics[2]?.id, topics[2] ? `${topics[2].label} is farther out.` : '');
  return stops.slice(0, 6);
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
        ? `You follow ${handle}. They sit near several saved posts in this demo.`
        : `${handle} sits near several saved posts in this demo.`,
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
      note: `A demo saved post about ${label.toLowerCase()}. Saved posts sit near their author and topics.`,
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
      note: `A demo suggestion: ${label}.`,
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
  const you: StimNode = withSearchLabel({
    id: SELF_NODE_ID,
    label: 'You',
    kind: 'person',
    x: 0.5,
    y: 0.5,
    size: 10,
    color: '#f2f2f0',
    note: 'This map is yours. Solid lines are saved posts. Dotted overlap is shared topics. Hairlines are accounts you follow.',
    evidence: 'You · demo map',
    self: true,
  });
  const nodes = [...topics, you, ...people, ...followOnly, ...sources, ...scouts].map((node) => (
    node.searchLabel ? node : withSearchLabel(node)
  ));
  edges.push(...buildFollowsEdges(SELF_NODE_ID, nodes));
  return { nodes, edges };
}

const demoGraph = buildDemoGraph();
const demoNodes = demoGraph.nodes;
const demoEdges = demoGraph.edges;

function semanticNodeKey(node: { id: string; label: string; kind: string }) {
  if (node.kind === 'topic') return `topic:${slug(node.label)}`;
  if (node.kind === 'person') {
    const handle = node.label.match(/@[a-z0-9_]+/i)?.[0].toLowerCase();
    return `person:${handle ?? slug(node.label.split('·')[0])}`;
  }
  return node.id;
}

function buildDemoCapsule(): GraphCapsule {
  const overlapIds = new Set([
    'topic:generative-interfaces',
    'topic:tools-for-thought',
    'topic:living-archives',
    'person:mirafields',
    'person:theopark',
  ]);
  const overlapNodes = demoNodes
    .filter((node) => overlapIds.has(node.id) && (node.kind === 'topic' || node.kind === 'person'))
    .map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind as 'topic' | 'person',
      x: node.x,
      y: node.y,
      size: node.size,
      color: node.color,
      note: node.note,
      evidence: 'Shared neighborhood · Bookmark text withheld',
      origin: 'seed' as const,
    }));
  const newNodes: StimNode[] = [
    { id: 'topic:civic-simulation', label: 'Civic simulation', kind: 'topic', x: .58, y: .32, size: 13, color: '#74b7ff', note: 'Shared models for rehearsing public choices.', evidence: 'Shared neighborhood · Bookmark text withheld', origin: 'seed' },
    { id: 'topic:slow-computing', label: 'Slow computing', kind: 'topic', x: .72, y: .55, size: 12, color: '#8de4bb', note: 'Software that values reflection over throughput.', evidence: 'Shared neighborhood · Bookmark text withheld', origin: 'seed' },
    { id: 'topic:biodesign', label: 'Biodesign', kind: 'topic', x: .54, y: .72, size: 12, color: '#c8c4bc', note: 'Design methods shaped by living systems.', evidence: 'Shared neighborhood · Bookmark text withheld', origin: 'seed' },
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
  return {
    version: 1,
    name: 'Iris’s field',
    rootId: 'topic:generative-interfaces',
    nodes: [
      ...overlapNodes,
      ...newNodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind as 'topic' | 'person',
        x: node.x,
        y: node.y,
        size: node.size,
        color: node.color,
        note: node.note,
        evidence: node.evidence,
        origin: 'seed' as const,
      })),
    ],
    edges,
  };
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

  capsule.nodes.forEach((node) => {
    const key = semanticNodeKey(node);
    const existing = nodeByKey.get(key);
    if (existing) {
      existing.origin = 'bridge';
      existing.x = 0.48 + (existing.x - 0.48) * 0.22;
      existing.size = Math.min(19, existing.size * 1.22);
      existing.color = '#f2f2f0';
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

const GraphCanvas = memo(function GraphCanvas({
  nodes,
  edges,
  selectedId,
  searchNeedleRef,
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
  searchNeedleRef: { current: string };
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
  const edgesRef = useRef(edges);
  const selectedIdRef = useRef(selectedId);
  const nodeByIdRef = useRef(new Map(nodes.map((node) => [node.id, node])));
  const adjacencyRef = useRef(new Map<string, string[]>());
  const matchCacheRef = useRef({ key: '', set: null as Set<string> | null });
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
    duration: 720,
    fromYaw: 0,
    fromPitch: 0,
    fromZ: 1,
    toYaw: 0,
    toPitch: 0,
    toZ: 1,
  });

  useLayoutEffect(() => {
    tuningRef.current = tuning;
    freshIdsRef.current = freshIds;
    busyRef.current = busy;
    nodesRef.current = nodes;
    edgesRef.current = edges;
    selectedIdRef.current = selectedId;
    nodeByIdRef.current = new Map(nodes.map((node) => [node.id, node]));
    const adjacency = new Map<string, string[]>();
    for (const edge of edges) {
      const fromList = adjacency.get(edge.from);
      if (fromList) fromList.push(edge.to);
      else adjacency.set(edge.from, [edge.to]);
      const toList = adjacency.get(edge.to);
      if (toList) toList.push(edge.from);
      else adjacency.set(edge.to, [edge.from]);
    }
    adjacencyRef.current = adjacency;
    frameIdsRef.current = frameIds;
  }, [busy, edges, frameIds, freshIds, nodes, selectedId, tuning]);

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
    const yawDelta = Math.abs(lerpAngle(rotationRef.current.yaw, face.yaw, 1) - rotationRef.current.yaw);
    const pitchDelta = Math.abs(face.pitch - rotationRef.current.pitch);
    const zoomDelta = Math.abs(nextZoom - zoomRef.current);
    if (yawDelta < 0.03 && pitchDelta < 0.03 && zoomDelta < 0.04) return;
    cameraAnimRef.current = {
      active: true,
      start: performance.now(),
      duration: 720,
      fromYaw: rotationRef.current.yaw,
      fromPitch: rotationRef.current.pitch,
      fromZ: zoomRef.current,
      toYaw: face.yaw,
      toPitch: face.pitch,
      toZ: nextZoom,
    };
  }, [frameToken]);

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
      const nextWidth = Math.round(rect.width * ratio);
      const nextHeight = Math.round(rect.height * ratio);
      if (
        canvas.width === nextWidth
        && canvas.height === nextHeight
        && Math.abs(transformRef.current.width - rect.width) < 0.5
        && Math.abs(transformRef.current.height - rect.height) < 0.5
      ) {
        transformRef.current = { left: 0, top: 0, width: rect.width, height: rect.height };
        return;
      }
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      transformRef.current = { left: 0, top: 0, width: rect.width, height: rect.height };
    };

    let cancelled = false;
    const draw = (time: number) => {
      if (cancelled) return;
      if (document.hidden) return;
      const settings = tuningRef.current;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const selectedId = selectedIdRef.current;
      const nodeById = nodeByIdRef.current;
      const needle = searchNeedleRef.current.trim().toLowerCase();
      const matchKey = `${needle}:${nodes.length}:${nodes[0]?.id ?? ''}`;
      if (matchCacheRef.current.key !== matchKey) {
        matchCacheRef.current = {
          key: matchKey,
          set: needle
            ? new Set(nodes.filter((node) => (node.searchLabel ?? node.label.toLowerCase()).includes(needle) || node.note.toLowerCase().includes(needle)).map((node) => node.id))
            : null,
        };
      }
      const matches = matchCacheRef.current.set;
      const camera = cameraAnimRef.current;
      if (camera.active) {
        const progress = Math.min(1, (time - camera.start) / camera.duration);
        const ease = 1 - (1 - progress) ** 4;
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
      const theme: ThemeName = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      const { width, height } = transformRef.current;
      const motionStrength = prefersReducedMotion ? 0 : (settings.motion / 100) * (busyRef.current ? 1.15 : 1) * (camera.active ? 0.2 : 1);
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
        const washTint = theme === 'light' ? '10, 10, 10' : '242, 242, 240';
        wash.addColorStop(0, `rgba(${washTint}, 0)`);
        wash.addColorStop(0.5, `rgba(${washTint}, ${theme === 'light' ? 0.06 : 0.045})`);
        wash.addColorStop(1, `rgba(${washTint}, 0)`);
        context.fillStyle = wash;
        context.fillRect(0, 0, width, height);
      }

      const ice = settings.palette === 'ice';
      const phosphor = settings.palette === 'phosphor';
      const accent = ice
        ? (theme === 'light' ? '#0a6a82' : '#7ee0ff')
        : phosphor
          ? (theme === 'light' ? '#111111' : '#f2f2f0')
          : (theme === 'light' ? '#1a1a1a' : '#d8d8d4');
      const dustRgb = theme === 'light' ? '22, 22, 20' : '210, 210, 206';
      const starRgb = theme === 'light' ? '22, 22, 20' : '232, 232, 228';
      const labelRgb = theme === 'light' ? '18, 18, 16' : '236, 236, 232';
      const edgeRgb = theme === 'light' ? '18, 18, 16' : '220, 220, 216';
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
          context.fillStyle = `rgba(${dustRgb}, ${0.025 + ((index * 17) % 7) * 0.006})`;
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
      if (theme === 'light') {
        volume.addColorStop(0, ice ? 'rgba(10, 106, 130, 0.08)' : phosphor ? 'rgba(0, 0, 0, 0.05)' : 'rgba(20, 20, 18, 0.05)');
        volume.addColorStop(0.45, 'rgba(255, 255, 252, 0.22)');
        volume.addColorStop(0.82, 'rgba(236, 236, 232, 0.42)');
        volume.addColorStop(1, 'rgba(228, 228, 224, 0.58)');
      } else {
        volume.addColorStop(0, ice ? 'rgba(90, 150, 170, 0.07)' : phosphor ? 'rgba(255, 255, 255, 0.05)' : 'rgba(220, 220, 216, 0.04)');
        volume.addColorStop(0.45, 'rgba(8, 8, 8, 0.22)');
        volume.addColorStop(0.82, 'rgba(0, 0, 0, 0.55)');
        volume.addColorStop(1, 'rgba(0, 0, 0, 0.78)');
      }
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
        context.fillStyle = `rgba(${starRgb}, ${0.08 + star.z * 0.18})`;
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
        const neighbors = adjacencyRef.current.get(focusId);
        if (neighbors) neighbors.forEach((id) => connected.add(id));
      }

      const sphereById = new Map<string, SpherePoint>();
      const animatedPoints = new Map<string, { x: number; y: number; z: number; reach: number }>();
      nodes.forEach((node, index) => {
        const sphere = rotateSphere(nodeToSphere(node), rotationRef.current.yaw, rotationRef.current.pitch);
        sphereById.set(node.id, sphere);
        const scale = globe.radius * layerRadius(node);
        const depth = 0.4 + 0.6 * Math.max(0, sphere.z);
        const amplitude = motionStrength * (node.kind === 'source' ? 1.2 : node.kind === 'person' ? 0.8 : 0.5) * depth;
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
      if (theme === 'dark') context.globalCompositeOperation = 'lighter';
      nodes.forEach((node) => {
        if (node.kind !== 'topic') return;
        const point = animatedPoints.get(node.id);
        if (!point || point.z < 0.02) return;
        const color = tunedNodeColor(node, settings.palette, theme);
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
        const focusColor = focusedNode ? tunedNodeColor(focusedNode, settings.palette, theme) : accent;
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
        const isFollows = edge.kind === 'follows';
        const active = !focusId || edge.from === focusId || edge.to === focusId;
        if (focusId && !active && (isFollows || edgeIndex % 2 !== 0)) return;
        if (!focusId && isFollows && edgeIndex % 3 !== 0) return;
        if (!focusId && !isFollows && edges.length > 1800 && edge.weight < .45 && edgeIndex % 2 !== 0) return;
        const fromSphere = sphereById.get(from.id);
        const toSphere = sphereById.get(to.id);
        if (!fromSphere || !toSphere) return;
        const midZ = (fromSphere.z + toSphere.z) / 2;
        if (isFollows && !active && midZ < 0.04) return;
        const searchVisible = !matches || matches.has(edge.from) || matches.has(edge.to);
        const signalAlpha = edge.kind === 'affinity' ? 0.62 : isFollows ? 0.38 : 1;
        const fromColor = tunedNodeColor(from, settings.palette, theme);
        const toColor = tunedNodeColor(to, settings.palette, theme);
        const depthFade = 0.22 + 0.78 * Math.max(0, midZ);
        if (focusId && active && searchVisible) {
          context.strokeStyle = `rgba(${edgeRgb}, ${(0.1 + edge.weight * 0.18) * signalAlpha * depthFade})`;
        } else {
          const alpha = active && searchVisible ? (0.05 + edge.weight * 0.09) * signalAlpha * depthFade : 0.028 * depthFade;
          context.strokeStyle = `rgba(${edgeRgb}, ${alpha})`;
        }
        if (!isFollows && focusId && active && searchVisible && fromSphere.z > 0.08 && toSphere.z > 0.08) {
          const a = projectSpherePoint(fromSphere);
          const b = projectSpherePoint(toSphere);
          const gradient = context.createLinearGradient(a.x, a.y, b.x, b.y);
          gradient.addColorStop(0, `${fromColor}${edge.kind === 'affinity' ? '26' : '42'}`);
          gradient.addColorStop(0.5, `rgba(${edgeRgb}, ${(0.09 + edge.weight * 0.16) * signalAlpha * depthFade})`);
          gradient.addColorStop(1, `${toColor}${edge.kind === 'affinity' ? '26' : '42'}`);
          context.strokeStyle = gradient;
        }
        const fromReach = animatedPoints.get(from.id)?.reach ?? 0;
        const toReach = animatedPoints.get(to.id)?.reach ?? 0;
        const reachBoost = 1 + Math.max(fromReach, toReach) * 1.8;
        context.lineWidth = (isFollows ? 0.28 : active ? 0.4 + edge.weight * 0.7 : 0.32) * (0.7 + 0.3 * Math.max(0, midZ));
        if (edge.kind === 'affinity') context.setLineDash([1.2, 4.5]);
        else if (isFollows) context.setLineDash([3.4, 6.2]);
        context.globalAlpha = Math.min(1, (active && searchVisible ? 1 : 0.55) * reachBoost);
        context.beginPath();
        let drawing = false;
        const steps = isFollows ? 5 : fromSphere.z > 0.2 && toSphere.z > 0.2 ? 8 : 12;
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
        if (edge.kind === 'affinity' || isFollows) context.setLineDash([]);

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
        const visible = !matches || matches.has(node.id);
        const fresh = freshIdsRef.current.has(node.id);
        const depth = 0.38 + 0.62 * Math.max(0, point.z);
        const backFade = point.z < 0 ? 0.22 + 0.2 * (point.z + 1) : 1;
        const pulse = 1 + Math.sin(motionTime * 0.0008 + index * 0.7) * (fresh || node.kind === 'scout' ? 0.16 : 0.07);
        const kindScale = node.kind === 'topic' ? 0.34 : node.kind === 'person' ? 0.3 : node.kind === 'scout' ? 0.27 : 0.24;
        const radius = Math.max(1.2, node.size * kindScale) * pulse * Math.sqrt(zoomRef.current) * depth * (1 + point.reach * 0.35) + (hovered || selected || fresh ? 1.8 : 0);
        const nodeColor = tunedNodeColor(node, settings.palette, theme);
        const inHand = point.reach > 0.18 && point.z > -0.05;

        context.globalAlpha = (related && visible ? 1 : visible ? 0.52 : 0.16) * backFade * (0.75 + point.reach * 0.4);
        const shouldGlow = point.z > -0.02 && (selected || hovered || fresh || inHand || node.kind === 'scout' || node.kind === 'topic' || node.origin === 'bridge');
        if (shouldGlow) {
          context.save();
          if (theme === 'dark') context.globalCompositeOperation = 'lighter';
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
        } else if (isSelf(node)) {
          const ring = Math.max(2.2, radius * 0.92);
          context.strokeStyle = hexRgba(nodeColor, selected || hovered ? 0.95 : 0.72);
          context.lineWidth = selected || hovered ? 1.7 : 1.15;
          context.beginPath();
          context.arc(point.x, point.y, ring, 0, Math.PI * 2);
          context.stroke();
          context.fillStyle = nodeColor;
          context.beginPath();
          context.arc(point.x, point.y, Math.max(1.1, ring * 0.28), 0, Math.PI * 2);
          context.fill();
        } else {
          context.fillStyle = nodeColor;
          context.beginPath();
          context.arc(point.x, point.y, Math.max(1.25, radius * 0.66), 0, Math.PI * 2);
          context.fill();
        }

        if ((node.kind === 'scout' || fresh) && point.z > 0.08) {
          context.strokeStyle = node.kind === 'scout' ? hexRgba(theme === 'light' ? '#0a6a82' : '#7ee0ff', 0.45) : hexRgba(accent, 0.45);
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

        const showLabel = point.z > 0.04 && (hovered || selected || fresh || inHand || node.origin === 'bridge' || isSelf(node) || (needle.length > 0 && visible) ||
          (settings.labels === 'topics' && node.kind === 'topic' && node.size >= 13 && (!focusId || connected.has(node.id))) ||
          (settings.labels === 'all' && node.kind !== 'source' && (!focusId || connected.has(node.id))));
        if (showLabel) {
          const close = hovered || selected || inHand;
          context.font = `${close ? 580 : 430} ${close ? 11.5 : 9.5}px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
          context.textAlign = 'center';
          context.fillStyle = visible && related
            ? `rgba(${labelRgb}, ${0.55 + Math.max(point.reach, close ? 0.4 : 0) * 0.4})`
            : `rgba(${labelRgb},.32)`;
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
      cancelled = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(frameRef.current);
    };
  }, [getPoint, searchNeedleRef]);

  const hitTest = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let hit: StimNode | null = null;
    let closest = Number.POSITIVE_INFINITY;
    for (const node of nodesRef.current) {
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
  }, [getPoint]);

  return (
    <canvas
      ref={canvasRef}
      className="graph-canvas"
      aria-label="Interactive globe of topics, people, bookmarks, and overlap links"
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
        cameraAnimRef.current.active = false;
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
});

function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => window.clearTimeout(timer));
}

type ConnectionState = {
  connected: boolean;
  configured?: boolean;
  backgroundPolling?: boolean;
  profile?: { id: string; username: string; name: string; profileImageUrl?: string };
};

type GraphResponse = {
  nodes: StimNode[];
  edges: Edge[];
  totals: { bookmark_count: number; author_count: number; scout_count?: number; following_count?: number };
  scope?: 'overview' | 'wide';
};

type ViewMode = 'table' | 'explore' | 'map' | 'people' | 'threads' | 'bookmarks' | 'scout' | 'neighborhood' | 'blend' | 'feeds';

type TraceKind = 'boot' | 'sync' | 'map' | 'live' | 'enrich' | 'scout' | 'rss' | 'note';

type TraceEvent = {
  id: number;
  at: number;
  kind: TraceKind;
  title: string;
  detail?: string;
};

type FieldActivity = {
  kind: TraceKind;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exploreTrail, setExploreTrail] = useState<ExploreTrail>({ steps: [], cursor: -1 });
  const [exploreVisited, setExploreVisited] = useState<Set<string>>(new Set());
  const [exploreDetailsOpen, setExploreDetailsOpen] = useState(false);
  const [exploreOrientation, setExploreOrientation] = useState<ExploreOrientation>('LR');
  const [query, setQuery] = useState('');
  const [connection, setConnection] = useState<ConnectionState>({ connected: false });
  const [connecting, setConnecting] = useState(false);
  const [graphNodes, setGraphNodes] = useState<StimNode[]>(demoNodes);
  const [graphEdges, setGraphEdges] = useState<Edge[]>(demoEdges);
  const [totals, setTotals] = useState<{ bookmark_count: number; author_count: number; scout_count?: number; following_count?: number }>({
    bookmark_count: demoBookmarkSeeds.length,
    author_count: demoPeopleSeeds.length,
    scout_count: demoScoutSeeds.length,
    following_count: demoFollowedIndexes.size + demoFollowOnlySeeds.length,
  });
  const [mode, setMode] = useState<'demo' | 'live' | 'shared'>('demo');
  const [shareName, setShareName] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [incomingShare, setIncomingShare] = useState<GraphCapsule | null>(null);
  const [sharePath, setSharePath] = useState('');
  const [view, setView] = useState<ViewMode>('table');
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [pulling, setPulling] = useState(false);
  const [liveInserted, setLiveInserted] = useState(0);
  const [liveWatch, setLiveWatch] = useState(false);
  const [liveWatchReady, setLiveWatchReady] = useState(false);
  const [xReads, setXReads] = useState(0);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [enrichState, setEnrichState] = useState<'idle' | 'enriching' | 'done' | 'error'>('idle');
  const [enrichMessage, setEnrichMessage] = useState('');
  const [scoutState, setScoutState] = useState<'idle' | 'scouting' | 'done' | 'error'>('idle');
  const [scoutMessage, setScoutMessage] = useState('');
  const [keepScouting, setKeepScouting] = useState(false);
  const [activity, setActivity] = useState<FieldActivity | null>(null);
  const [seedGraph, setSeedGraph] = useState<GraphCapsule | null>(null);
  const [fieldScope, setFieldScope] = useState<'overview' | 'wide'>('overview');
  const [neighborhoodRootId, setNeighborhoodRootId] = useState<string | null>(null);
  const [neighborhoodDepth, setNeighborhoodDepth] = useState(2);
  const [capsuleMessage, setCapsuleMessage] = useState('');
  const [prefsReady, setPrefsReady] = useState(false);
  const [tuning, setTuning] = useState<GraphTuning>(defaultTuning);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [frameToken, setFrameToken] = useState(0);
  const [frameIds, setFrameIds] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [theme, setTheme] = useState<ThemeName>('dark');
  const [themeReady, setThemeReady] = useState(false);
  const [feeds, setFeeds] = useState<FeedProbe[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [traceOpen, setTraceOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [guideIndex, setGuideIndex] = useState(-1);
  const [rssState, setRssState] = useState<'idle' | 'probing' | 'done' | 'error'>('idle');
  const traceIdRef = useRef(0);
  const deferredQuery = useDeferredValue(query);
  const deferredDensity = useDeferredValue(tuning.density);
  const deferredSignalFloor = useDeferredValue(tuning.signalFloor);
  const searchNeedleRef = useRef(query);
  useLayoutEffect(() => { searchNeedleRef.current = query; }, [query]);
  const searchRef = useRef<HTMLInputElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const readerTitleRef = useRef<HTMLHeadingElement>(null);
  const fieldScopeRef = useRef(fieldScope);
  const syncingRef = useRef(false);
  const topicCount = graphNodes.filter((node) => node.kind === 'topic').length;
  const peopleCount = graphNodes.filter((node) => node.kind === 'person' && !isSelf(node)).length;
  const sourceCount = graphNodes.filter((node) => node.kind === 'source').length;
  const scoutCount = graphNodes.filter((node) => node.kind === 'scout').length;
  const liveState: 'off' | 'watching' | 'pulling' = mode === 'live' && connection.connected && liveWatch
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
    const needle = paletteOpen ? '' : deferredQuery.trim().toLowerCase();
    return visibleNodes.filter((node) =>
      directoryView
      || node.id === selectedId
      || node.kind === 'topic'
      || isSelf(node)
      || node.origin === 'bridge'
      || (needle.length > 0 && (node.searchLabel ?? node.label.toLowerCase()).includes(needle))
      || stableFraction(node.id) <= deferredDensity / 100,
    );
  }, [deferredDensity, deferredQuery, directoryView, paletteOpen, selectedId, visibleNodes]);
  const viewTuning = useMemo(() => (
    directoryView || view === 'blend' ? { ...tuning, labels: 'all' as const } : tuning
  ), [directoryView, tuning, view]);
  const roster = useMemo(() => {
    const bySize = (nodes: StimNode[]) => [...nodes].sort((first, second) => second.size - first.size);
    if (view === 'people') {
      const people = graphNodes.filter((node) => node.kind === 'person');
      const you = people.filter((node) => isSelf(node));
      const saved = bySize(people.filter((node) => !isFollowOnly(node) && !isSelf(node))).slice(0, 10);
      const following = people.filter((node) => isFollowOnly(node)).slice(0, 6);
      return [...you, ...saved, ...following];
    }
    if (view === 'threads') return bySize(graphNodes.filter((node) => node.kind === 'topic')).slice(0, 14);
    if (view === 'bookmarks') return graphNodes.filter((node) => node.kind === 'source').slice(0, 16);
    if (view === 'scout') return graphNodes.filter((node) => node.kind === 'scout').slice(0, 16);
    if (view === 'neighborhood') return visibleNodes.filter((node) => node.kind !== 'source').slice(0, 16);
    if (view === 'blend') return blendedGraph.nodes.filter((node) => node.origin === 'bridge' || node.origin === 'seed').slice(0, 14);
    return [];
  }, [blendedGraph.nodes, graphNodes, view, visibleNodes]);
  const guideStops = useMemo(() => buildGuideStops(graphNodes, graphEdges), [graphEdges, graphNodes]);
  const guideStop = guideIndex >= 0 ? guideStops[guideIndex] ?? null : null;
  const paletteHits = useMemo(() => rankSearchHits(query, graphNodes, PALETTE_COMMANDS).map((hit) => ({
    ...hit,
    kind: hit.kind === 'command' ? 'command' as const : hit.kind as NodeKind,
  })), [graphNodes, query]);
  const renderedNodeIds = useMemo(() => new Set(renderedNodes.map((node) => node.id)), [renderedNodes]);
  const renderedEdges = useMemo(() => visibleEdges.filter((edge) =>
    renderedNodeIds.has(edge.from) && renderedNodeIds.has(edge.to) &&
    edge.weight * 100 >= deferredSignalFloor
    && (tuning.affinities || edge.kind !== 'affinity')
    && (tuning.follows || edge.kind !== 'follows'),
  ), [deferredSignalFloor, renderedNodeIds, tuning.affinities, tuning.follows, visibleEdges]);
  const nodeById = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
  const availableExploreIds = useMemo(() => new Set(graphNodes.map((node) => node.id)), [graphNodes]);
  const activeExploreTrail = useMemo(() => pruneExploreTrail(exploreTrail, availableExploreIds), [availableExploreIds, exploreTrail]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
  const readerIndex = useMemo(() => buildExploreIndex(view === 'blend' ? blendedGraph.nodes : graphNodes, activeEdges), [activeEdges, blendedGraph.nodes, graphNodes, view]);
  const selectedConnections = useMemo(() => selectedId ? exploreConnections(readerIndex, selectedId)
    .map(({ node, edge }) => ({ neighbor: node, edge })) : [], [readerIndex, selectedId]);
  const supportingPosts = selectedConnections.filter(({ neighbor, edge }) => neighbor.kind === 'source' && edge.kind === 'evidence');
  const relatedIdeas = selectedConnections.filter(({ neighbor }) => neighbor.kind !== 'source').slice(0, 5);
  const previousConnection = selectedConnections.find(({ neighbor }) => neighbor.id === activeExploreTrail.steps[activeExploreTrail.cursor - 1]);
  const globeBusy = activity?.kind === 'sync' || activity?.kind === 'scout' || activity?.kind === 'enrich' || activity?.kind === 'rss';
  const showInspector = view === 'explore' || view === 'table'
    ? permissionsOpen || (Boolean(selected) && exploreDetailsOpen)
    : Boolean(selected) || view !== 'map' || permissionsOpen;
  useEffect(() => {
    if (!showInspector || !selectedId) return;
    const frame = window.requestAnimationFrame(() => readerTitleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId, showInspector]);
  const stageCopy = activity?.kind === 'sync'
    ? {
        eyebrow: 'SYNC',
        title: activity.current ? `${activity.current} bookmarks in.` : 'Opening bookmarks.',
        detail: activity.tick ?? activity.detail ?? 'X is sending pages of saved posts.',
      }
    : activity?.kind === 'scout'
        ? { eyebrow: 'GROK SCOUT', title: activity.label.includes('Scouting') ? 'Searching X…' : 'Suggested posts.', detail: activity.detail ?? 'Cyan diamonds are suggestions, not bookmarks.' }
        : activity?.kind === 'enrich'
          ? { eyebrow: 'GROK', title: 'Naming topics.', detail: activity.detail ?? activity.label }
          : view === 'blend' && seedGraph
            ? { eyebrow: 'COMBINED MAP', title: `Yours and ${seedGraph.name}`, detail: 'Matching people and topics are highlighted. Other nodes stay on their own graph.' }
            : view === 'neighborhood'
              ? { eyebrow: `${neighborhoodDepth}-STEP NEIGHBORHOOD`, title: 'Around this node.', detail: 'Each step adds nodes one link farther out.' }
              : view === 'people'
                ? { eyebrow: 'PEOPLE', title: 'Authors and accounts you follow.', detail: 'Bookmark authors are brighter. Followed accounts with no saves are quieter.' }
                : view === 'threads'
                  ? { eyebrow: 'TOPICS', title: 'Topics on the map.', detail: 'Diamonds are topics. Click a row to fly to one.' }
                  : view === 'bookmarks'
                    ? { eyebrow: 'BOOKMARKS', title: 'Saved posts.', detail: 'Each post sits near its author.' }
                    : view === 'scout'
                      ? { eyebrow: 'GROK SCOUT', title: 'Suggested posts.', detail: 'Cyan diamonds are suggestions, not bookmarks.' }
                      : activity?.kind === 'rss'
                        ? { eyebrow: 'RSS', title: activity.label, detail: activity.detail ?? 'Looking for feed links on sites saved in bookmarks.' }
                        : view === 'feeds'
                          ? { eyebrow: 'RSS', title: 'Linked sites and feeds.', detail: 'Probe extracts hosts from saved posts, then looks for RSS or Atom.' }
                          : mode === 'shared'
                            ? { eyebrow: 'SHARED', title: shareName ?? 'A shared map.', detail: 'People and topics only. Bookmark text is not in this link. Drag to spin.' }
                            : { eyebrow: mode === 'live' ? 'LIVE' : 'DEMO', title: 'Stuff that interests me.', detail: 'Drag to spin. G walks the map. / to search.' };

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
      setView((current) => current === 'table' ? 'table' : 'explore');
      setSeedGraph(null);
      setNeighborhoodRootId(null);
    }
    if (options?.selectId) setSelectedId(options.selectId);
    else if (!options?.keepView) setSelectedId(null);
    else {
      setSelectedId((current) => (current && data.nodes.some((node) => node.id === current) ? current : null));
    }
    return true;
  }, []);

  const flyTo = useCallback((ids: string[]) => {
    setFrameIds(ids);
    setFrameToken((token) => token + 1);
  }, []);

  const enterBlend = useCallback((localNodes: StimNode[], localEdges: Edge[], capsule: GraphCapsule) => {
    const combined = combineGraphs(localNodes, localEdges, capsule);
    setSeedGraph(capsule);
    setShareName(capsule.name);
    setIncomingShare(capsule);
    setView('blend');
    setSelectedId(combined.rootId);
    setCapsuleMessage(`Combined with ${capsule.name}. Matching people and topics are highlighted.`);
    flyTo(combined.nodes.filter((node) => node.origin === 'bridge' || node.origin === 'seed').map((node) => node.id));
  }, [flyTo]);
  const enterBlendRef = useRef(enterBlend);
  useEffect(() => {
    enterBlendRef.current = enterBlend;
  }, [enterBlend]);

  const combineIncomingWithDemo = useCallback(() => {
    const capsule = incomingShare;
    if (!capsule) return;
    setGraphNodes(demoNodes);
    setGraphEdges(demoEdges);
    setTotals({
      bookmark_count: demoBookmarkSeeds.length,
      author_count: demoPeopleSeeds.length,
      scout_count: demoScoutSeeds.length,
      following_count: demoFollowedIndexes.size + demoFollowOnlySeeds.length,
    });
    setMode('demo');
    enterBlend(demoNodes, demoEdges, capsule);
  }, [enterBlend, incomingShare]);

  const pushTrace = useCallback((kind: TraceKind, title: string, detail?: string) => {
    const id = (traceIdRef.current += 1);
    setTrace((current) => [{ id, at: Date.now(), kind, title, detail }, ...current].slice(0, 48));
  }, []);

  const focusNode = useCallback((id: string, options?: { keepGuide?: boolean; via?: string; keepReader?: boolean }) => {
    if (!options?.keepGuide) setGuideIndex(-1);
    setPermissionsOpen(false);
    setSelectedId(id);
    setExploreDetailsOpen(Boolean(options?.keepReader));
    const steps = options?.via ? [options.via, id] : [id];
    setExploreTrail((current) => visitExploreTrail(pruneExploreTrail(current, availableExploreIds), steps));
    setExploreVisited((current) => new Set([...current, ...steps]));
    const nearby = collectNeighborhoodIds(id, graphNodes, graphEdges, 1);
    flyTo([...nearby]);
  }, [availableExploreIds, flyTo, graphEdges, graphNodes]);

  const handleSelect = useCallback((id: string | null) => {
    if (id) focusNode(id);
    else {
      setSelectedId(null);
      setGuideIndex(-1);
    }
  }, [focusNode]);

  const runGuide = useCallback((delta: 1 | -1) => {
    if (guideStops.length === 0) return;
    setTuning((current) => (current.guides ? current : { ...current, guides: true }));
    setView((current) => current === 'explore' ? 'explore' : 'map');
    setPermissionsOpen(false);
    setPaletteOpen(false);
    setHelpOpen(false);
    setTuningOpen(false);
    const next = guideIndex < 0
      ? (delta < 0 ? guideStops.length - 1 : 0)
      : (guideIndex + delta + guideStops.length) % guideStops.length;
    setGuideIndex(next);
    const stop = guideStops[next];
    if (stop) focusNode(stop.id, { keepGuide: true });
  }, [focusNode, guideIndex, guideStops]);

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
    setScoutMessage('Grok is searching X using your topics…');
    setActivity({ kind: 'scout', label: 'Scouting X', detail: 'Grok is searching X using your topics' });
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
        setActivity({ kind: 'scout', label: `${result.found} scouted`, detail: 'New suggestions on the map' });
      }
      window.setTimeout(() => setActivity((current) => current?.kind === 'scout' ? null : current), 2200);
    } catch (error) {
      setScoutState('error');
      setScoutMessage(error instanceof Error ? error.message : 'Grok scout failed.');
      setActivity(null);
    }
  }, [loadLiveGraph, markFresh]);

  const probeRss = useCallback(async () => {
    setView('feeds');
    setTuningOpen(false);
    setRssState('probing');
    setActivity({ kind: 'rss', label: 'Probing sites for RSS', detail: mode === 'live' ? 'Hosts from saved posts' : 'Demo sites' });
    try {
      const response = await fetch('/api/rss', { method: 'POST' });
      if (!response.ok) throw new Error('RSS probe failed.');
      const nextFeeds: FeedProbe[] = [];
      await readNdjson<{
        type: 'host' | 'done' | 'error';
        host?: string;
        status?: FeedProbe['status'];
        feedCount?: number;
        feeds?: FeedProbe['feeds'];
        title?: string;
        pageUrl?: string;
        error?: string;
        probed?: number;
        found?: number;
        remaining?: number;
      }>(response, (event) => {
        if (event.type === 'error') throw new Error(event.error ?? 'RSS probe failed.');
        if (event.type === 'host' && event.host) {
          nextFeeds.push({
            host: event.host,
            pageUrl: event.pageUrl ?? `https://${event.host}`,
            feeds: event.feeds ?? [],
            status: event.status === 'found' || event.status === 'none' || event.status === 'error' ? event.status : 'none',
            error: event.error,
            probedAt: Date.now(),
          });
          setFeeds([...nextFeeds]);
          setActivity({
            kind: 'rss',
            label: event.host,
            current: event.probed,
            total: (event.probed ?? 1) + (event.remaining ?? 0),
            detail: event.status === 'found' ? `${event.feedCount} feed${event.feedCount === 1 ? '' : 's'}` : event.status,
            tick: event.title,
          });
        }
        if (event.type === 'done') {
          setRssState('done');
          setActivity({
            kind: 'rss',
            label: (event.probed ?? 0) === 0 ? 'Feeds are current' : `${event.found ?? 0} sites with feeds`,
            detail: `${event.probed ?? 0} probed`,
          });
        }
      });
      window.setTimeout(() => setActivity((current) => current?.kind === 'rss' ? null : current), 2200);
    } catch (error) {
      setRssState('error');
      setActivity(null);
      pushTrace('rss', 'RSS probe failed', error instanceof Error ? error.message : 'RSS probe failed.');
    }
  }, [mode, pushTrace]);

  useEffect(() => {
    if (!activity || activity.kind === 'boot' || activity.kind === 'map') return;
    pushTrace(activity.kind, activity.label, activity.tick ?? activity.detail);
  }, [activity, pushTrace]);

  useEffect(() => {
    fieldScopeRef.current = fieldScope;
  }, [fieldScope]);

  useEffect(() => {
    syncingRef.current = syncState === 'syncing';
  }, [syncState]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const auth = url.searchParams.get('auth');
    if (auth !== 'invalid' && auth !== 'failed' && auth !== 'connected') return;
    // Apply the browser-only callback result after the first render has hydrated.
    const frame = window.requestAnimationFrame(() => {
      setSyncState(auth === 'connected' ? 'idle' : 'error');
      setSyncMessage(auth === 'invalid'
        ? 'X connect did not complete. Try Connect X again from the app where you started sign-in.'
        : auth === 'failed'
          ? 'X sign-in could not be completed. Check that the configured callback address matches this app.'
          : 'X connected. Sync your bookmarks to start exploring.');
      setPermissionsOpen(true);
      url.searchParams.delete('auth');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const fromPath = window.location.pathname.match(/^\/s\/([A-Za-z0-9_-]{6,16})$/);
    const fromQuery = new URLSearchParams(window.location.search).get('s');
    const shareId = fromPath?.[1] ?? fromQuery;
    let cancelled = false;
    const abort = new AbortController();
    let finished = false;
    let slowTimer = 0;

    const finishBoot = () => {
      finished = true;
      window.clearTimeout(slowTimer);
      if (!cancelled) {
        setActivity((current) => (current?.kind === 'boot' || current?.kind === 'map' ? null : current));
      }
    };

    const timedFetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
      fetchWithTimeout(input, { ...init, signal: abort.signal }, 12_000);

    void (async () => {
      try {
        const statusResponse = await timedFetch('/api/auth/x/status', { cache: 'no-store' });
        const status = (await statusResponse.json()) as ConnectionState;
        if (cancelled) return;
        if (shareId) setSharePath(`/s/${shareId}`);
        setConnection(status);

        const graphPromise = status.connected
          ? timedFetch('/api/graph?scope=overview', { cache: 'no-store' })
            .then(async (graphResponse) => {
              if (!graphResponse.ok) return null;
              return (await graphResponse.json()) as GraphResponse;
            })
            .catch(() => null)
          : Promise.resolve(null);

        const sharePromise = shareId
          ? timedFetch(`/api/share/${shareId}`, { cache: 'no-store' }).then(async (shareResponse) => {
              const payload = (await shareResponse.json()) as { capsule?: unknown; error?: string };
              if (!shareResponse.ok) throw new Error(payload.error ?? 'This share link could not be opened.');
              const capsule = parseCapsule(payload.capsule);
              if (!capsule) throw new Error('This share is empty.');
              return capsule;
            })
          : Promise.resolve(null);

        if (status.connected || shareId) {
          slowTimer = window.setTimeout(() => {
            if (cancelled || finished) return;
            setActivity({
              kind: 'map',
              label: status.connected ? 'Loading your map' : 'Opening shared map',
              detail: status.connected ? `@${status.profile?.username ?? 'you'}` : undefined,
            });
          }, 1200);
        }

        const [graphData, capsule] = await Promise.all([graphPromise, sharePromise]);
        if (cancelled) return;

        let mineNodes = demoNodes;
        let mineEdges = demoEdges;
        let mineLive = false;
        if (graphData && graphData.nodes.length > 0) {
          mineNodes = graphData.nodes;
          mineEdges = graphData.edges;
          mineLive = true;
          setGraphNodes(graphData.nodes);
          setGraphEdges(graphData.edges);
          setTotals(graphData.totals);
          setFieldScope(graphData.scope ?? 'overview');
          setMode('live');
        }

        if (capsule) {
          setIncomingShare(capsule);
          setShareName(capsule.name);
          if (mineLive) {
            enterBlendRef.current(mineNodes, mineEdges, capsule);
          } else {
            setMode('shared');
            setGraphNodes(capsule.nodes.map((node) => ({ ...node })));
            setGraphEdges(capsule.edges);
            setTotals({
              bookmark_count: 0,
              author_count: capsule.nodes.filter((node) => node.kind === 'person').length,
              scout_count: 0,
              following_count: 0,
            });
            setView('explore');
            setSelectedId(capsule.rootId);
            setExploreTrail({ steps: capsule.rootId ? [capsule.rootId] : [], cursor: capsule.rootId ? 0 : -1 });
            setExploreVisited(new Set(capsule.rootId ? [capsule.rootId] : []));
            setCapsuleMessage('Connect X to lay this on your map, or combine it with the demo.');
          }
        } else if (status.connected && !graphData) {
          setCapsuleMessage('Your map did not load in time. Try Sync.');
        }

        if (status.connected) {
          window.setTimeout(() => {
            if (cancelled) return;
            void timedFetch('/api/rss', { cache: 'no-store' })
              .then(async (rss) => {
                if (!rss.ok || cancelled) return;
                const payload = (await rss.json()) as { feeds?: FeedProbe[] };
                if (!cancelled) setFeeds(payload.feeds ?? []);
              })
              .catch(() => {
                // RSS is optional; the map already painted.
              });
          }, 0);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        if (shareId) setCapsuleMessage(error instanceof Error ? error.message : 'This share link could not be opened.');
      } finally {
        finishBoot();
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
      window.clearTimeout(slowTimer);
    };
  }, []);

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
        setHelpOpen(false);
        return;
      }
      if (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setPaletteIndex(0);
        setPaletteOpen(true);
        setHelpOpen(false);
        return;
      }
      if (event.key === 'Escape') {
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        if (exploreDetailsOpen) {
          setExploreDetailsOpen(false);
          return;
        }
        if (selectedId) {
          setSelectedId(null);
          setExploreTrail((current) => ({ ...current, cursor: -1 }));
          setGuideIndex(-1);
          return;
        }
        if (permissionsOpen) {
          setPermissionsOpen(false);
          return;
        }
        searchRef.current?.blur();
      }
      if (event.key.toLowerCase() === 't' && !(event.target instanceof HTMLInputElement) && !paletteOpen) {
        setTuningOpen((open) => !open);
      }
      if (event.key.toLowerCase() === 'l' && !(event.target instanceof HTMLInputElement) && !paletteOpen) {
        setTraceOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exploreDetailsOpen, helpOpen, paletteOpen, permissionsOpen, selectedId]);

  useLayoutEffect(() => {
    const savedTuning = readStoredTuning();
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    let watch = false;
    try {
      watch = window.localStorage.getItem('stimgraph:liveWatch') === '1';
    } catch {
      // Preference is optional.
    }
    const frame = window.requestAnimationFrame(() => {
      setTuning(savedTuning);
      setTheme(current);
      setThemeReady(true);
      setLiveWatch(watch);
      setLiveWatchReady(true);
      setPrefsReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    try {
      window.localStorage.setItem('stimgraph:tuning', JSON.stringify(tuning));
    } catch {
      // Device preferences are optional; the graph still works without them.
    }
  }, [prefsReady, tuning]);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('stimgraph:theme', theme);
    } catch {
      // Theme still applies for this session if storage is blocked.
    }
  }, [theme, themeReady]);

  useEffect(() => {
    if (!liveWatchReady) return;
    try {
      window.localStorage.setItem('stimgraph:liveWatch', liveWatch ? '1' : '0');
    } catch {
      // Preference is optional.
    }
  }, [liveWatch, liveWatchReady]);

  useEffect(() => {
    if (connection.backgroundPolling || !liveWatch || mode !== 'live' || !connection.connected) return;
    let cancelled = false;
    let timer = 0;
    let emptyStreak = 0;
    let lastPull = 0;

    const nextDelay = () => {
      if (emptyStreak >= 2) return 8 * 60_000;
      if (emptyStreak >= 1) return 3 * 60_000;
      return 90_000;
    };

    const pull = async () => {
      if (cancelled || document.hidden || syncingRef.current) return;
      if (Date.now() - lastPull < 20_000) return;
      lastPull = Date.now();
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
        setXReads((count) => count + 1);
        if ((result.inserted ?? 0) > 0) {
          emptyStreak = 0;
          setLiveInserted((count) => count + (result.inserted ?? 0));
          await loadLiveGraph({ keepView: true });
          markFresh((result.insertedIds ?? []).map((id) => `bookmark:${id}`));
          setActivity({ kind: 'live', label: `${result.inserted} new saves`, detail: 'New saves on the map' });
        } else {
          emptyStreak += 1;
          setActivity({
            kind: 'live',
            label: 'Saves are current',
            detail: `Next check in ${Math.round(nextDelay() / 60_000)}m`,
          });
        }
      } catch {
        emptyStreak += 1;
      } finally {
        if (!cancelled) {
          setPulling(false);
          window.setTimeout(() => setActivity((current) => current?.kind === 'live' ? null : current), 1600);
        }
      }
    };

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await pull();
        if (!cancelled) schedule(nextDelay());
      }, delay);
    };

    schedule(8_000);
    const onVisible = () => {
      if (!document.hidden) void pull();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      setPulling(false);
    };
  }, [connection.backgroundPolling, connection.connected, liveWatch, loadLiveGraph, markFresh, mode]);

  useEffect(() => {
    if (!connection.backgroundPolling || !connection.connected || mode === 'shared') return;
    let cancelled = false;
    let busy = false;
    let latestCursor = -1;
    const refresh = async () => {
      if (cancelled || busy || document.hidden || syncingRef.current) return;
      busy = true;
      try {
        const response = await fetch('/api/activity?limit=1', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
        if (!response.ok) return;
        const result = await response.json() as { latestCursor: number };
        if (!cancelled && latestCursor !== result.latestCursor) {
          await loadLiveGraph({ keepView: true });
          latestCursor = result.latestCursor;
        }
      } catch {
        // A temporary failure is retried without making a second X poller.
      } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [connection.backgroundPolling, connection.connected, loadLiveGraph, mode]);

  useEffect(() => {
    if (!keepScouting || mode !== 'live' || !connection.connected) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) void runScout();
    }, 12 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [connection.connected, keepScouting, mode, runScout]);

  const syncBookmarks = async () => {
    setSyncState('syncing');
    setSyncMessage('Opening bookmarks…');
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
            detail: event.type === 'done' ? 'Building the map' : `Page ${event.page ?? 1}`,
            tick: authors || undefined,
          });
        }
        setSyncMessage(authors
          ? `${imported} in · ${inserted} new${authors ? ` · ${authors}` : ''}`
          : `${imported} bookmarks in · ${inserted} new`);
        if (event.type === 'page' || event.type === 'following') {
          setXReads((count) => count + 1);
        }
        if ((event.insertedIds?.length ?? 0) > 0) {
          markFresh(event.insertedIds!.map((id) => `bookmark:${id}`));
        }
        const remap = event.type === 'done' || event.type === 'following' || event.page === 1 || ((event.page ?? 0) % 2 === 0 && event.hasMore);
        if (remap) {
          setActivity((current) => current ? { ...current, detail: 'Building the map' } : current);
          await loadLiveGraph({ keepView: true });
        }
      });
      setSyncState('done');
      setLiveInserted((count) => count + inserted);
      setSyncMessage(followingError
        ? `${imported} bookmarks mapped · ${inserted} new. ${followingError}`
        : `${imported} bookmarks mapped · ${inserted} new · ${following} following.`);
      setActivity({
        kind: 'sync',
        label: 'Map updated',
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
    setActivity({ kind: 'enrich', label: 'Naming topics', detail: 'Next 40 bookmarks → Grok' });
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
        setActivity({ kind: 'enrich', label: 'Topics are current' });
      } else {
        const retention = result.zeroDataRetention ? ' · ZDR confirmed' : '';
        setEnrichMessage(`${result.analyzed ?? 0} bookmarks gained ${result.topics ?? 0} topic links · estimated $${(result.estimatedCostUsd ?? 0).toFixed(4)}${retention}`);
        setActivity({ kind: 'enrich', label: `${result.topics ?? 0} topic links`, detail: `${result.analyzed} bookmarks labeled` });
      }
      window.setTimeout(() => setActivity((current) => current?.kind === 'enrich' ? null : current), 2200);
    } catch (error) {
      setEnrichState('error');
      setEnrichMessage(error instanceof Error ? error.message : 'Grok enrichment failed.');
      setActivity(null);
    }
  };

  const enterView = useCallback((nextView: ViewMode) => {
    setTuningOpen(false);
    setPermissionsOpen(false);
    setView(nextView);
    if (nextView === 'explore') {
      setSelectedId(null);
      setExploreTrail((current) => ({ ...current, cursor: -1 }));
      setExploreDetailsOpen(false);
      return;
    }
    if (nextView === 'map') {
      setSelectedId(null);
      if (view !== 'map') flyTo(graphNodes.map((node) => node.id));
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
    if (nextView === 'feeds') {
      setSelectedId(null);
      flyTo(graphNodes.map((node) => node.id));
      return;
    }
    if (nextView === 'blend' && seedGraph) {
      const bridges = blendedGraph.nodes.filter((node) => node.origin === 'bridge' || node.origin === 'seed');
      setSelectedId(blendedGraph.rootId ?? bridges[0]?.id ?? null);
      flyTo(bridges.map((node) => node.id));
    }
  }, [blendedGraph.nodes, blendedGraph.rootId, flyTo, graphNodes, seedGraph, view]);

  const rediscover = useCallback(() => {
    if (visibleNodes.length === 0) return;
    if (view === 'explore') {
      const next = graphNodes.find((node) => node.kind === 'source' && !exploreVisited.has(node.id))
        ?? graphNodes.find((node) => node.kind === 'topic' && !exploreVisited.has(node.id));
      if (next) focusNode(next.id);
      return;
    }
    const currentIndex = visibleNodes.findIndex((node) => node.id === selectedId);
    const offset = randomOffset(visibleNodes.length - 1);
    const next = visibleNodes[(Math.max(0, currentIndex) + offset) % visibleNodes.length];
    setSelectedId(next.id);
    flyTo([...collectNeighborhoodIds(next.id, visibleNodes, visibleEdges, 1)]);
  }, [exploreVisited, flyTo, focusNode, graphNodes, selectedId, view, visibleEdges, visibleNodes]);

  const seedNeighborhood = useCallback(() => {
    const root = selectedId ?? neighborhoodRootId ?? graphNodes.find((node) => node.kind === 'topic')?.id;
    if (!root) return;
    setTuningOpen(false);
    setNeighborhoodRootId(root);
    setNeighborhoodDepth(2);
    setView('neighborhood');
    setSelectedId(root);
    flyTo([...collectNeighborhoodIds(root, graphNodes, graphEdges, 2)]);
  }, [flyTo, graphEdges, graphNodes, neighborhoodRootId, selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing || paletteOpen) return;
      if (event.key === '?' ) {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        runGuide(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        setGuideIndex(-1);
        rediscover();
        return;
      }
      if (event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setGuideIndex(-1);
        enterView('explore');
        return;
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        seedNeighborhood();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enterView, paletteOpen, rediscover, runGuide, seedNeighborhood]);

  const applyPaletteHit = (hit: PaletteHit) => {
    setPaletteOpen(false);
    if (hit.kind === 'command') {
      if (hit.id === 'cmd:guide') runGuide(1);
      else if (hit.id === 'cmd:explore') enterView('explore');
      else if (hit.id === 'cmd:keys') setHelpOpen(true);
      else if (hit.id === 'cmd:map') enterView('map');
      else if (hit.id === 'cmd:people') enterView('people');
      else if (hit.id === 'cmd:threads') enterView('threads');
      else if (hit.id === 'cmd:bookmarks') enterView('bookmarks');
      else if (hit.id === 'cmd:scout') enterView('scout');
      else if (hit.id === 'cmd:neighborhood') seedNeighborhood();
      else if (hit.id === 'cmd:combine') {
        if (seedGraph) enterView('blend');
        else if (incomingShare && mode === 'shared') combineIncomingWithDemo();
        else loadDemoCombination();
      } else if (hit.id === 'cmd:tune') {
        setTuningOpen(true);
        flyTo(graphNodes.map((node) => node.id));
      } else if (hit.id === 'cmd:feeds') {
        enterView('feeds');
      } else if (hit.id === 'cmd:log') {
        setTraceOpen(true);
      } else if (hit.id === 'cmd:share') {
        void copyShareLink();
      } else if (hit.id === 'cmd:rediscover') rediscover();
      else if (hit.id === 'cmd:sync') void syncBookmarks();
      return;
    }
    if (view === 'explore') setView('explore');
    else if (hit.kind === 'person') setView('people');
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
    setCapsuleMessage('Loading more authors, bookmarks, and weaker links…');
    try {
      const response = await fetch('/api/graph?scope=wide', { cache: 'no-store' });
      if (!response.ok) throw new Error('The wider map could not be loaded.');
      const data = (await response.json()) as GraphResponse;
      setGraphNodes(data.nodes);
      setGraphEdges(data.edges);
      setTotals(data.totals);
      setFieldScope('wide');
      setCapsuleMessage(`${data.nodes.length} nodes and ${data.edges.length} links are now in view.`);
    } catch (error) {
      setCapsuleMessage(error instanceof Error ? error.message : 'The wider map could not be loaded.');
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

  const makeShareCapsule = (): GraphCapsule | null => {
    const nonBookmarkNodes = graphNodes.filter((node) => node.kind !== 'source' && node.kind !== 'scout' && !isSelf(node));
    const nonBookmarkIds = new Set(nonBookmarkNodes.map((node) => node.id));
    let rootId = selectedId && nonBookmarkIds.has(selectedId) ? selectedId : null;
    if (!rootId && selectedId) {
      const neighborEdge = graphEdges.find((edge) =>
        (edge.from === selectedId && nonBookmarkIds.has(edge.to)) ||
        (edge.to === selectedId && nonBookmarkIds.has(edge.from)));
      rootId = neighborEdge ? (neighborEdge.from === selectedId ? neighborEdge.to : neighborEdge.from) : null;
    }
    rootId ??= nonBookmarkNodes[0]?.id ?? null;
    if (!rootId) return null;
    const neighborhoodIds = collectNeighborhoodIds(rootId, graphNodes, graphEdges, 2);
    const shareNodes = nonBookmarkNodes
      .filter((node) => neighborhoodIds.has(node.id) && (node.kind === 'topic' || node.kind === 'person'))
      .slice(0, 80)
      .map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind as 'topic' | 'person',
        x: node.x,
        y: node.y,
        size: node.size,
        color: node.color,
        note: 'Shared node.',
        evidence: 'Shared structure · Bookmark text withheld',
        origin: 'seed' as const,
      }));
    const shareIds = new Set(shareNodes.map((node) => node.id));
    return {
      version: 1,
      name: mode === 'live'
        ? `@${connection.profile?.username ?? 'someone'}’s map`
        : mode === 'shared' && shareName
          ? shareName
          : 'A Stimgraph demo map',
      rootId,
      nodes: shareNodes,
      edges: graphEdges.filter((edge) => shareIds.has(edge.from) && shareIds.has(edge.to) && edge.kind !== 'follows').slice(0, 240),
    };
  };

  const exportNeighborhood = () => {
    const capsule = makeShareCapsule();
    if (!capsule) return;
    const blob = new Blob([JSON.stringify(capsule, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stimgraph-${slug(selected?.label ?? 'neighborhood')}.stimgraph`;
    link.click();
    URL.revokeObjectURL(url);
    setCapsuleMessage(`Exported ${capsule.nodes.length} people and topics. Bookmark text stayed out.`);
  };

  const copyShareLink = async () => {
    const capsule = makeShareCapsule();
    if (!capsule) return;
    setCapsuleMessage('Publishing a link…');
    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capsule }),
      });
      const result = (await response.json()) as { url?: string; error?: string; nodes?: number };
      if (!response.ok || !result.url) throw new Error(result.error ?? 'The link could not be created.');
      setShareUrl(result.url);
      try {
        await navigator.clipboard.writeText(result.url);
        setCapsuleMessage(`Link copied. ${result.nodes ?? capsule.nodes.length} people and topics · bookmark text stayed out.`);
      } catch {
        setCapsuleMessage(result.url);
      }
    } catch (error) {
      setCapsuleMessage(error instanceof Error ? error.message : 'The link could not be created.');
    }
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
    setXReads(0);
    setScoutMessage('');
    setView('explore');
    setExploreTrail({ steps: [], cursor: -1 });
    setExploreVisited(new Set());
    setExploreDetailsOpen(false);
    setSeedGraph(null);
    setFieldScope('overview');
    setNeighborhoodRootId(null);
    setCapsuleMessage('');
    setSelectedId(null);
    setPermissionsOpen(false);
  };

  const deleteLocalData = async () => {
    const confirmed = window.confirm('Delete this local Stimgraph map, saved trajectories, and disconnect X? This cannot be undone.');
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

  const connectX = async () => {
    setConnecting(true);
    try {
      const response = await fetchWithTimeout('/api/auth/x/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not check X sign-in. Try again in a moment.');
      const status = await response.json() as ConnectionState;
      setConnection(status);
      if (status.configured === false) {
        throw new Error('X sign-in is not set up for this copy of Stimgraph. You can explore the demo here. To use your bookmarks, open the app where you configured X.');
      }
      window.location.assign(sharePath ? `/api/auth/x/start?return=${encodeURIComponent(sharePath)}` : '/api/auth/x/start');
    } catch (error) {
      setSyncState('error');
      setSyncMessage(error instanceof Error ? error.message : 'X sign-in could not start.');
      setSelectedId(null);
      setView('explore');
      setPermissionsOpen(true);
    } finally {
      setConnecting(false);
    }
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

        <button className="search-box" type="button" onClick={() => { setPaletteIndex(0); setPaletteOpen(true); setHelpOpen(false); }} aria-label="Search topics, people, and posts">
          <span aria-hidden="true">⌕</span>
          <span className={query ? 'search-value' : 'search-placeholder'}>{query || 'Search · @ # ~ :'}</span>
          <kbd>⌘K</kbd>
        </button>

        <div className="topbar-actions">
          <span className={`demo-pill ${mode === 'live' ? 'live' : ''}`}>
            <i /> {mode === 'live'
              ? `${totals.bookmark_count} saved${liveInserted ? ` · +${liveInserted}` : ''}`
              : mode === 'shared' ? (shareName ?? 'Shared') : 'Demo'}
          </span>
          <button
            className="theme-toggle"
            type="button"
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          {connection.connected ? (
            <button className="connect-button sync-button" type="button" onClick={syncBookmarks} disabled={syncState === 'syncing'}>
              {syncState === 'syncing'
                ? (activity?.kind === 'sync' && activity.current != null ? `${activity.current}/${activity.total}` : 'Syncing…')
                : `Sync @${connection.profile?.username ?? 'X'}`}
            </button>
          ) : (
            <button className="connect-button sync-button" type="button" onClick={() => void connectX()} disabled={connecting}>{connecting ? 'Checking X…' : 'Connect X'}</button>
          )}
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail" aria-label="Graph navigation">
          <nav>
            <button className={`rail-item ${view === 'table' ? 'active' : ''}`} type="button" onClick={() => enterView('table')}><span>☰</span>Bookmarks</button>
            <button className={`rail-item ${view === 'explore' ? 'active' : ''}`} type="button" onClick={() => enterView('explore')}><span>✧</span>Explore</button>
            <button className={`rail-item ${view === 'map' && !tuningOpen ? 'active' : ''}`} type="button" onClick={() => enterView('map')}><span>◎</span>Globe</button>
            <button className={`rail-item ${view === 'people' ? 'active' : ''}`} type="button" onClick={() => enterView('people')}><span>◎</span>People</button>
            <button className={`rail-item ${view === 'threads' ? 'active' : ''}`} type="button" onClick={() => enterView('threads')}><span>↝</span>Topics</button>
            <details className="rail-more">
            <summary className="rail-item"><span>⋯</span>More</summary>
            <button className={`rail-item ${view === 'bookmarks' ? 'active' : ''}`} type="button" onClick={() => enterView('bookmarks')}><span>✦</span>Saved posts</button>
            <button className={`rail-item ${view === 'scout' ? 'active' : ''}`} type="button" onClick={() => enterView('scout')}><span>⬡</span>Scout</button>
            <button className={`rail-item ${view === 'feeds' ? 'active' : ''}`} type="button" onClick={() => enterView('feeds')}><span>⇉</span>Feeds</button>
            <button className={`rail-item ${view === 'neighborhood' ? 'active' : ''}`} type="button" onClick={seedNeighborhood}><span>⊙</span>Neighborhood</button>
            <button className={`rail-item ${view === 'blend' ? 'active' : ''}`} type="button" onClick={() => seedGraph ? enterView('blend') : loadDemoCombination()}><span>⌁</span>Combine</button>
            <button className={`rail-item ${tuningOpen ? 'active' : ''}`} type="button" onClick={() => { setTuningOpen((open) => !open); flyTo(graphNodes.map((node) => node.id)); }}><span>◌</span>Tune</button>
            <button className={`rail-item ${guideIndex >= 0 ? 'active' : ''}`} type="button" onClick={() => runGuide(1)}><span>◐</span>Guide</button>
            <button className="rail-item" type="button" onClick={() => { setGuideIndex(-1); rediscover(); }}><span>◷</span>Rediscover</button>
            </details>
          </nav>

          <div className="rail-summary">
            <p className="eyebrow">{fieldScope === 'wide' ? 'WIDE MAP' : 'ON THE MAP'}</p>
            <dl>
              <div><dt>Topics</dt><dd>{topicCount}</dd></div>
              <div><dt>People</dt><dd>{peopleCount}</dd></div>
              <div><dt>Following</dt><dd>{totals.following_count ?? graphNodes.filter((node) => node.followed).length}</dd></div>
              <div><dt>Bookmarks</dt><dd>{sourceCount}</dd></div>
              <div><dt>Scouted</dt><dd>{scoutCount}</dd></div>
            </dl>
          </div>

          <button className={`permissions-link ${permissionsOpen && !selectedId && view === 'map' ? 'active' : ''}`} type="button" onClick={() => { setSelectedId(null); setPermissionsOpen((open) => !open); }}>
            <span>◇</span>
            <span><b>Read-only</b><small>Permissions and sharing</small></span>
          </button>
        </aside>

        <div className={`graph-stage palette-${tuning.palette} ${view === 'explore' ? 'explore-stage' : ''}`}>
          <div className={`stage-heading ${tuning.guides && view !== 'explore' && view !== 'table' ? '' : 'guide-hidden'}`} aria-hidden={!tuning.guides || view === 'explore' || view === 'table'}>
            <p className="eyebrow">{stageCopy.eyebrow}</p>
            <h1>{stageCopy.title}</h1>
            <p>{stageCopy.detail}</p>
          </div>
          <div className={`field-readout ${activity ? 'busy' : ''} ${(view === 'explore' || view === 'table') && !activity ? 'guide-hidden' : ''}`} aria-live="polite">
            {activity ? (
              <>
                <span>{activity.label}{activity.current != null ? `  ${activity.current}/${activity.total}` : ''}</span>
                {activity.tick ? <><i /><span>{activity.tick}</span></> : activity.detail ? <><i /><span>{activity.detail}</span></> : null}
              </>
            ) : (
              <>
                <span>{renderedNodes.length} nodes</span>
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
          <Suspense fallback={null}>
          {view !== 'table' ? <TrajectoryWorkbench
            key={`${mode}:${connection.profile?.id ?? shareName ?? 'demo'}`}
            nodes={graphNodes} edges={graphEdges} trail={activeExploreTrail} visited={exploreVisited}
            mode={mode} hidden={view !== 'explore'}
            onResume={(next) => {
              setExploreTrail(next);
              setSelectedId(next.steps[next.cursor] ?? null);
              setExploreVisited((current) => new Set([...current, ...next.steps]));
              setExploreDetailsOpen(false);
              setPermissionsOpen(false);
              setGuideIndex(-1);
            }}
          /> : null}
          {view === 'table' ? <BookmarkTable live={mode === 'live'} refreshKey={totals.bookmark_count} nodes={graphNodes} edges={graphEdges} /> : view === 'explore' ? <ExploreGraph
            orientation={exploreOrientation} onOrientationChange={setExploreOrientation}
            nodes={graphNodes} edges={graphEdges} selectedId={selectedId} trail={activeExploreTrail} visited={exploreVisited} mode={mode} theme={theme}
            shortcutsBlocked={paletteOpen || helpOpen || tuningOpen || showInspector}
            onSelect={(id, via) => focusNode(id, { via })}
            onTravel={(cursor) => {
              const id = activeExploreTrail.steps[cursor];
              if (!id || !nodeById.has(id)) return;
              setExploreTrail({ ...activeExploreTrail, cursor });
              setSelectedId(id);
              setExploreDetailsOpen(false);
            }}
            onHome={() => enterView('explore')}
            onInspect={() => setExploreDetailsOpen(true)}
            onSearch={() => { setPaletteIndex(0); setPaletteOpen(true); }}
            onScout={() => enterView('scout')}
          /> : <GraphCanvas nodes={renderedNodes} edges={renderedEdges} selectedId={selectedId} searchNeedleRef={searchNeedleRef} tuning={viewTuning} freshIds={freshIds} busy={globeBusy} frameToken={frameToken} frameIds={frameIds} onSelect={handleSelect} />}
          </Suspense>
          <div className={`legend ${tuning.guides && view !== 'explore' && view !== 'table' ? '' : 'guide-hidden'}`} aria-label="Graph legend" aria-hidden={!tuning.guides || view === 'explore' || view === 'table'}>
            {view === 'blend' && seedGraph ? (
              <>
                <span><i className="local-dot" />Yours</span>
                <span><i className="seed-dot" />{seedGraph.name}</span>
                <span><i className="bridge-dot" />Shared bridge</span>
              </>
            ) : (
              <>
                <span><i className="topic-dot" />Topic</span>
                <span><i className="self-dot" />You</span>
                <span><i className="person-dot" />Person</span>
                <span><i className="follow-dot" />Following</span>
                <span><i className="source-dot" />Bookmark</span>
                <span><i className="scout-dot" />Scout</span>
                <span className="affinity-key"><i />Overlap</span>
                <span className="follows-key"><i />Follows</span>
              </>
            )}
          </div>
          <section className={`tuning-deck ${tuningOpen ? 'open' : ''}`} aria-label="Graph controls" aria-hidden={!tuningOpen}>
            <div className="tuning-head">
              <div><p className="eyebrow">CONTROLS</p><h2>Graph controls</h2></div>
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
                <i /> Overlap links
              </button>
              <button className={`tuning-toggle ${tuning.follows ? 'active' : ''}`} type="button" aria-pressed={tuning.follows} onClick={() => setTuning((current) => ({ ...current, follows: !current.follows }))}>
                <i /> Following links
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
                    {labelMode === 'focus' ? 'Focus' : labelMode === 'topics' ? 'Topics' : 'All'}
                  </button>
                ))}
              </div>
            </div>
            <div className="tuning-section">
              <span>COLOR</span>
              <div className="palette-control">
                {(['spectrum', 'phosphor', 'ice'] as const).map((palette) => (
                  <button className={`${palette} ${tuning.palette === palette ? 'active' : ''}`} type="button" key={palette} onClick={() => setTuning((current) => ({ ...current, palette }))} aria-label={`${paletteLabel(palette)} colors`}>
                    <i /><b>{paletteLabel(palette)}</b>
                  </button>
                ))}
              </div>
            </div>
            <div className="tuning-foot">
              <button type="button" onClick={() => setTuning({ ...defaultTuning })}>Reset</button>
              <span><kbd>T</kbd> toggle controls</span>
            </div>
          </section>

          {showInspector ? (
          <aside className={`inspector ${selected || view !== 'map' ? 'has-selection' : ''} ${selected ? 'reader-panel' : ''}`} aria-label={selected ? 'Bookmark reader and connections' : 'Map details and settings'}>
          {selected ? (
            <>
              <div className="inspector-topline">
                <div className="focus-badges">
                  <span className={`kind-badge ${isSelf(selected) ? 'self' : selected.kind}`}>{isSelf(selected) ? 'you' : selected.kind === 'source' ? 'bookmark' : selected.kind === 'scout' ? 'scout' : selected.kind}</span>
                  {selected.origin === 'seed' || selected.origin === 'bridge' ? <span className={`origin-badge ${selected.origin}`}>{selected.origin === 'bridge' ? 'on both maps' : 'shared with you'}</span> : null}
                  {selected.followed ? <span className="origin-badge following">following</span> : null}
                </div>
                <button type="button" onClick={() => view === 'explore' ? setExploreDetailsOpen(false) : setSelectedId(null)} aria-label="Close details">×</button>
              </div>
              <p className="reader-purpose">{selected.kind === 'source' ? 'Read the saved post and follow the ideas inside it.' : 'See what connects here and the saved posts behind it.'}</p>
              <h2 ref={readerTitleRef} tabIndex={-1}>{selected.label}</h2>
              <p className={`inspector-note ${selected.kind === 'source' ? 'reader-saved-text' : ''}`}>{selected.note}</p>
              {selected.url ? <a className="reader-open-link" href={selected.url} target="_blank" rel="noreferrer">{selected.kind === 'source' ? 'Open original saved post' : selected.kind === 'person' ? 'Open profile' : 'Open original'} ↗</a> : null}

              <div className="focus-evidence">
                <span>{previousConnection ? 'HOW YOU GOT HERE' : 'FROM YOUR COLLECTION'}</span>
                {previousConnection ? <strong>{connectionReason(previousConnection.neighbor, selected, previousConnection.edge)} · {previousConnection.neighbor.label}</strong> : null}
                <strong>{selected.evidence}</strong>
              </div>

              {supportingPosts.length ? <section className="reader-connections" aria-label="Saved posts behind this">
                <h3>Saved posts behind this <span>{supportingPosts.length}</span></h3>
                {supportingPosts.slice(0, 4).map(({ neighbor }) => <button key={neighbor.id} type="button" onClick={() => { setView(availableExploreIds.has(neighbor.id) ? 'explore' : 'blend'); focusNode(neighbor.id, { keepReader: true }); }}><strong>{neighbor.label}</strong><span className="reader-excerpt">{neighbor.note}</span><small>Read bookmark →</small></button>)}
              </section> : mode === 'shared' ? <p className="reader-empty-note">Saved post text is not included in this shared graph.</p> : null}
              {relatedIdeas.length ? <section className="reader-connections" aria-label="Connected ideas">
                <h3>Connected ideas</h3>
                {relatedIdeas.map(({ neighbor, edge }) => <button key={neighbor.id} type="button" onClick={() => { setView(availableExploreIds.has(neighbor.id) ? 'explore' : 'blend'); focusNode(neighbor.id, { keepReader: true }); }}><strong>{neighbor.label}</strong><small>{activeExploreTrail.steps.slice(0, activeExploreTrail.cursor + 1).includes(neighbor.id) ? 'Return to this step on your trail' : connectionReason(selected, neighbor, edge)} →</small></button>)}
              </section> : null}
              <button className="reader-return" type="button" onClick={() => { setView(availableExploreIds.has(selected.id) ? 'explore' : 'blend'); focusNode(selected.id); }}>Continue on the canvas →</button>
              <details className="reader-more"><summary>More actions</summary>
              <div className="focus-actions">
                <button type="button" onClick={seedNeighborhood}>Grow from here</button>
                {view === 'neighborhood' && neighborhoodDepth < 4 ? <button type="button" onClick={growNeighborhood}>+ one step</button> : null}
                <button type="button" onClick={() => void copyShareLink()}>Copy link</button>
                <button type="button" onClick={exportNeighborhood}>Export file</button>
                <button type="button" onClick={() => importRef.current?.click()}>Import a graph</button>
                {mode === 'live' && fieldScope === 'overview' ? <button type="button" onClick={pullWiderField}>Load more nodes</button> : null}
                {mode === 'shared' && incomingShare ? <button type="button" onClick={combineIncomingWithDemo}>Combine with demo</button> : null}
                {mode === 'shared' && connection.connected ? <button type="button" onClick={() => void loadLiveGraph()}>Open my map</button> : null}
                {seedGraph ? <button type="button" onClick={clearCombination}>Separate graphs</button> : null}
              </div>
              </details>
              {capsuleMessage ? <p className="capsule-message">{capsuleMessage}</p> : null}
              {shareUrl ? <a className="node-link" href={shareUrl}>{shareUrl.replace(/^https?:\/\//, '')}</a> : null}
            </>
          ) : view !== 'map' && view !== 'explore' && view !== 'table' ? (
            <div className="view-panel">
              <p className="eyebrow">{view === 'people' ? 'PEOPLE' : view === 'threads' ? 'TOPICS' : view === 'bookmarks' ? 'BOOKMARKS' : view === 'scout' ? 'GROK SCOUT' : view === 'neighborhood' ? 'NEIGHBORHOOD' : view === 'feeds' ? 'RSS' : 'COMBINED MAP'}</p>
              <h2>{view === 'people' ? 'Authors and accounts you follow.' : view === 'threads' ? 'Topics.' : view === 'bookmarks' ? 'Saved posts.' : view === 'scout' ? 'Suggested posts.' : view === 'neighborhood' ? 'This neighborhood.' : view === 'feeds' ? 'Linked sites and feeds.' : seedGraph ? `Yours and ${seedGraph.name}` : 'Combine two graphs.'}</h2>
              <p className="inspector-note">{view === 'people' ? 'Bookmark authors first, then quieter accounts you follow. Click a row to fly to them.' : view === 'threads' ? 'Topics from Grok or hashtags on saved posts. Click a row to fly to that diamond.' : view === 'bookmarks' ? 'Recent bookmarks. Open one to see why it is on the map.' : view === 'scout' ? 'Cyan diamonds are suggestions, not bookmarks. Scout searches X using your topics.' : view === 'neighborhood' ? 'Nodes within two steps of the selection. Grow or export this set.' : view === 'feeds' ? (mode === 'live' ? 'Hosts come from links inside saved posts. The probe fetches each site and looks for RSS or Atom.' : 'Demo probe of public sites. After you sync bookmarks, this uses your saved links.') : 'Matching people and topics are highlighted. Bookmark text is left out of the file.'}</p>
              {view === 'scout' && connection.connected && mode === 'live' ? (
                <div className="view-actions">
                  <button className="ai-button scout" type="button" onClick={() => void runScout()} disabled={scoutState === 'scouting'}>
                    {scoutState === 'scouting' ? 'Searching X…' : 'Search X'}
                  </button>
                  {scoutMessage ? <p className={`sync-message ${scoutState}`}>{scoutMessage}</p> : null}
                </div>
              ) : null}
              {view === 'threads' && connection.connected && mode === 'live' ? (
                <div className="view-actions">
                  <button className="ai-button" type="button" onClick={enrichBookmarks} disabled={enrichState === 'enriching'}>
                    {enrichState === 'enriching' ? 'Naming topics…' : 'Name topics for the next 40'}
                  </button>
                  {enrichMessage ? <p className={`sync-message ${enrichState}`}>{enrichMessage}</p> : null}
                </div>
              ) : null}
              {view === 'neighborhood' ? (
                <div className="view-actions">
                  {neighborhoodDepth < 4 ? <button className="wide-connect" type="button" onClick={growNeighborhood}>Grow one more step</button> : null}
                  <button className="wide-connect" type="button" onClick={() => void copyShareLink()}>Copy link</button>
                  <button className="wide-connect" type="button" onClick={exportNeighborhood}>Export file</button>
                </div>
              ) : null}
              {view === 'blend' ? (
                <div className="view-actions">
                  <button className="wide-connect" type="button" onClick={() => void copyShareLink()}>Copy this overlap</button>
                  <button className="wide-connect" type="button" onClick={() => importRef.current?.click()}>Open .stimgraph file</button>
                  {seedGraph ? <button className="wide-connect" type="button" onClick={clearCombination}>Separate graphs</button> : null}
                </div>
              ) : null}
              {view === 'feeds' ? (
                <div className="view-actions">
                  <button className="ai-button" type="button" onClick={() => void probeRss()} disabled={rssState === 'probing'}>
                    {rssState === 'probing' ? 'Probing sites…' : feeds.length > 0 ? 'Probe again' : 'Probe RSS'}
                  </button>
                </div>
              ) : null}
              {view === 'feeds' ? (
                <div className="feed-list">
                  {feeds.length === 0 ? <p className="capsule-message">{rssState === 'probing' ? 'Checking sites…' : 'No probe yet.'}</p> : feeds.map((feed) => (
                    <div className="feed-card" key={feed.host}>
                      <span>{feed.host}</span>
                      <b className={`feed-status ${feed.status}`}>{feed.status}</b>
                      {feed.feeds[0] ? <a href={feed.feeds[0].url} target="_blank" rel="noreferrer">{feed.feeds[0].type} ↗</a> : null}
                      <small>{feed.status === 'found' ? feed.feeds.map((item) => item.title || item.type).join(' · ') : feed.error ?? 'No feed link found.'}</small>
                    </div>
                  ))}
                </div>
              ) : (
              <div className="connections-list">
                {roster.length === 0 ? <p className="capsule-message">Nothing in this slice yet.</p> : roster.map((node) => (
                  <button type="button" key={node.id} onClick={() => focusNode(node.id)}>
                    <i style={{ background: tunedNodeColor(node, tuning.palette, theme) }} />
                    <span>{node.label}</span>
                    <b>{node.kind === 'source' ? 'bookmark' : isFollowOnly(node) ? 'following' : node.kind}</b>
                  </button>
                ))}
              </div>
              )}
              {capsuleMessage ? <p className="capsule-message">{capsuleMessage}</p> : null}
            </div>
          ) : (
            <div className="permissions-panel">
              <span className="permission-icon">◇</span>
              <p className="eyebrow">{mode === 'shared' ? 'SHARED MAP' : connection.connected ? 'X CONNECTED' : 'PERMISSIONS'}</p>
              <h2>{mode === 'shared' ? (shareName ?? 'A shared map.') : connection.connected ? `Ready, @${connection.profile?.username}.` : 'Connect X to map your bookmarks.'}</h2>
              <p>{mode === 'shared'
                ? 'People and topics only. Bookmark text is not in this link. Combine with the demo, or connect X and it will lay onto your map when you come back.'
                : connection.connected
                ? (connection.backgroundPolling ? 'Bookmarks sync in the background every six hours, even with this tab closed. This map refreshes automatically.' : 'Sync pulls bookmarks and who you follow. Live watch of new saves is optional and off by default.')
                : 'Read-only: bookmarks, following, posts, profiles. It cannot post, like, follow, or change bookmarks.'}</p>
              {connection.connected ? (
                <button className="wide-connect" type="button" onClick={syncBookmarks} disabled={syncState === 'syncing'}>
                  {syncState === 'syncing'
                    ? (activity?.kind === 'sync' && activity.current != null
                      ? `Mapping ${activity.current} of ${activity.total}…`
                      : 'Opening bookmarks…')
                    : 'Sync bookmarks and following'}
                </button>
              ) : (
                <button className="wide-connect" type="button" onClick={() => void connectX()} disabled={connecting}>{connecting ? 'Checking X…' : 'Review and connect X'}</button>
              )}
              {syncMessage ? <p className={`sync-message ${syncState}`}>{syncMessage}</p> : null}
              {syncMessage.includes('Reconnect X') ? <a className="node-link" href="/api/auth/x/start">Reconnect X to grant follows.read ↗</a> : null}
              {connection.connected && mode === 'live' && !connection.backgroundPolling ? (
                <button
                  className={`tuning-toggle ${liveWatch ? 'active' : ''}`}
                  type="button"
                  aria-pressed={liveWatch}
                  onClick={() => setLiveWatch((value) => !value)}
                  style={{ marginTop: 12 }}
                >
                  <i /> Watch for new saves while this tab is open
                </button>
              ) : null}
              <small>About $0.60 per 600 bookmarks at <a href="https://docs.x.com/x-api/getting-started/pricing" target="_blank" rel="noreferrer">X’s owned-read rate</a>. Bookmark text stays local until you approve Grok.</small>

              {connection.connected && mode === 'live' ? (
                <section className="ai-consent-card" aria-label="Optional Grok enrichment">
                  <p className="eyebrow">SEPARATE AI CONSENT</p>
                  <h3>Send 40 bookmarks to Grok to name topics?</h3>
                  <p>This click sends the next 40 bookmark texts and author handles to xAI. Your X token, profile token, and existing graph are never sent.</p>
                  <p>Requests use <code>store: false</code>. xAI says API content may still be retained for abuse review for up to 30 days unless your team has Zero Data Retention enabled; it is not used for training without permission.</p>
                  <button className="ai-button" type="button" onClick={enrichBookmarks} disabled={enrichState === 'enriching'}>
                    {enrichState === 'enriching' ? 'Naming topics…' : 'Name topics for the next 40'}
                  </button>
                  {enrichMessage ? <p className={`sync-message ${enrichState}`}>{enrichMessage}</p> : null}
                  <small><a href="https://docs.x.ai/developers/pricing" target="_blank" rel="noreferrer">Current Grok rates</a>: $2/M input tokens and $6/M output tokens. A small batch is normally cents; exact usage is reported after each run.</small>
                </section>
              ) : null}

              {connection.connected && mode === 'live' ? (
                <section className="ai-consent-card" aria-label="Grok scout">
                  <p className="eyebrow">GROK SCOUT</p>
                  <h3>Search X for posts you have not saved.</h3>
                  <p>Grok searches X with <code>x_search</code> using your top topics, frequent authors, and accounts you follow. It does not send bookmark text or your X token.</p>
                  <button className="ai-button scout" type="button" onClick={() => void runScout()} disabled={scoutState === 'scouting'}>
                    {scoutState === 'scouting' ? 'Searching X…' : 'Search X'}
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
                <p className="eyebrow">SHARE</p>
                <h3>Send a link.</h3>
                <p>Copy a URL to this neighborhood. Anyone with the link can explore people, topics, and how they connect. Bookmark text is left out. You can still export a .stimgraph file.</p>
                <div>
                  {incomingShare && mode === 'shared' ? <button type="button" onClick={combineIncomingWithDemo}>Combine with demo</button> : null}
                  <button type="button" onClick={() => void copyShareLink()}>Copy link to this map</button>
                  <button type="button" onClick={loadDemoCombination}>Try a second graph</button>
                  <button type="button" onClick={() => importRef.current?.click()}>Open .stimgraph file</button>
                  <button type="button" onClick={() => void probeRss()} disabled={rssState === 'probing'}>{rssState === 'probing' ? 'Probing RSS…' : 'Probe RSS on linked sites'}</button>
                </div>
                {capsuleMessage ? <p className="capsule-message">{capsuleMessage}</p> : null}
              </section>
            </div>
          )}
          <input ref={importRef} className="capsule-input" type="file" accept=".stimgraph,application/json" onChange={importNeighborhood} />
          <footer className="inspiration-credit">
            Interaction credit: <a href="https://x.com/poetengineer__/status/1821654144958202077" target="_blank" rel="noreferrer">Kat ⊷ the Poet Engineer’s gestural latent-space work</a>. Stimgraph’s design and code are original.
          </footer>
          </aside>
          ) : null}
          {guideStop ? (
            <div className="demo-caption" role="status">
              <b>Guide {guideIndex + 1}/{guideStops.length} · G next · shift+G back</b>
              {guideStop.beat}
            </div>
          ) : null}
        </div>
      </section>
      {paletteOpen ? (
        <div className="palette-back" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
          <div className="palette" role="dialog" aria-label="Search topics, people, and posts" onKeyDown={(event) => {
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
                placeholder="@person  #topic  ~following  :command"
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
              <span>@ people</span>
              <span># topics</span>
              <span>~ following</span>
              <span>: cmds</span>
              <span className="spacer" />
              <span>{paletteHits.length} hits</span>
            </div>
          </div>
        </div>
      ) : null}
      {helpOpen ? (
        <div className="palette-back" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}>
          <div className="keys-sheet" role="dialog" aria-label="Keyboard shortcuts">
            <p className="eyebrow">KEYS</p>
            <h2>Guide and search</h2>
            <dl>
              <div><dt><kbd>{exploreOrientation === 'LR' ? '↑ ↓' : '← →'}</kbd></dt><dd>Choose an exploration branch</dd></div>
              <div><dt><kbd>{exploreOrientation === 'LR' ? '→' : '↓'}</kbd></dt><dd>Follow the chosen branch</dd></div>
              <div><dt><kbd>{exploreOrientation === 'LR' ? '←' : '↑'}</kbd></dt><dd>Back along your trail</dd></div>
              <div><dt><kbd>G</kbd></dt><dd>Walk the strongest nodes</dd></div>
              <div><dt><kbd>⇧G</kbd></dt><dd>Previous stop</dd></div>
              <div><dt><kbd>R</kbd></dt><dd>Jump somewhere new</dd></div>
              <div><dt><kbd>H</kbd></dt><dd>All interests</dd></div>
              <div><dt><kbd>N</kbd></dt><dd>Neighborhood from focus</dd></div>
              <div><dt><kbd>/</kbd></dt><dd>Search · @ people · # topics · ~ following · : commands</dd></div>
              <div><dt><kbd>T</kbd></dt><dd>Graph controls</dd></div>
              <div><dt><kbd>L</kbd></dt><dd>Activity log</dd></div>
              <div><dt><kbd>?</kbd></dt><dd>This list</dd></div>
              <div><dt><kbd>esc</kbd></dt><dd>Close</dd></div>
            </dl>
            <p className="keys-note">Double-click the globe to recenter. Drag to spin. Scroll to zoom.</p>
          </div>
        </div>
      ) : null}

      <div className={`trace-panel ${traceOpen ? 'open' : ''}`} aria-label="Activity log">
        {trace.length === 0 ? <p className="trace-empty">Nothing has run yet. Sync, scout, or probe RSS and the steps show here.</p> : trace.map((event) => (
          <div className="trace-row" key={event.id}>
            <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
            <b>{event.kind}</b>
            <span>{event.detail ? `${event.title} · ${event.detail}` : event.title}</span>
          </div>
        ))}
      </div>
      <footer className="status-bar">
        <button className="log-toggle" type="button" onClick={() => setTraceOpen((open) => !open)} aria-pressed={traceOpen} aria-label="Toggle activity log">
          {liveState === 'off' ? <i className="idle-dot" /> : <i className="live-dot" />}
          {activity?.kind === 'sync' ? `sync ${activity.current ?? 0}/${activity.total ?? 600}`
            : activity?.kind === 'rss' ? `rss ${activity.current ?? 0}/${activity.total ?? 0}`
            : liveState === 'pulling' ? 'pulling bookmarks'
              : liveState === 'watching' ? 'watch on'
                : mode === 'live' ? 'watch off'
                  : mode === 'shared' ? 'shared · log'
                    : 'demo · log'}
        </button>
        <span><b>{totals.bookmark_count}</b> saved</span>
        <span><b>{totals.following_count ?? 0}</b> following</span>
        <span className="scout-count"><b>{totals.scout_count ?? scoutCount}</b> scouted</span>
        <span className="spacer" />
        <span>~{xReads} X reads</span>
        <span>{renderedNodes.length} nodes</span>
      </footer>
    </main>
  );
}
