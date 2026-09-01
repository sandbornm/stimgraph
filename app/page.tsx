'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type NodeKind = 'topic' | 'person' | 'source';

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
};

type Edge = {
  from: string;
  to: string;
  weight: number;
  kind: 'evidence' | 'affinity';
};

const demoTopicSeeds = [
  ['Generative interfaces', '#d7ff72', 'Interfaces that make abstract systems tangible, spatial, and responsive.'],
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

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

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
  const people: StimNode[] = demoPeopleSeeds.map(([name, handle], index) => ({
    id: `person:${slug(handle)}`,
    label: `${name} · ${handle}`,
    kind: 'person',
    ...demoFieldPosition(index, demoPeopleSeeds.length, 'outer'),
    size: 6 + (index % 5) * 0.55,
    color: '#f4f1e9',
    note: `${handle} appears near several saved threads in this fictional demo constellation.`,
    evidence: `${2 + (index % 7)} demo bookmarks`,
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
  return { nodes: [...topics, ...people, ...sources], edges };
}

const demoGraph = buildDemoGraph();
const demoNodes = demoGraph.nodes;
const demoEdges = demoGraph.edges;

function GraphCanvas({
  nodes,
  edges,
  selectedId,
  query,
  onSelect,
}: {
  nodes: StimNode[];
  edges: Edge[];
  selectedId: string | null;
  query: string;
  onSelect: (id: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<string | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, down: false, moved: false });
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const frameRef = useRef(0);
  const lastDrawRef = useRef(0);
  const transformRef = useRef({ left: 0, top: 0, width: 0, height: 0 });
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

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
    const bounds = transformRef.current;
    const zoom = zoomRef.current;
    const pan = panRef.current;
    const innerWidth = Math.max(480, bounds.width * 0.82);
    const innerHeight = Math.max(420, bounds.height * 0.82);
    return {
      x: bounds.left + bounds.width / 2 + (node.x - 0.5) * innerWidth * zoom + pan.x,
      y: bounds.top + bounds.height / 2 + (node.y - 0.5) * innerHeight * zoom + pan.y,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      transformRef.current = { left: 0, top: 0, width: rect.width, height: rect.height };
    };

    const draw = (time: number) => {
      if (time - lastDrawRef.current < 28) {
        frameRef.current = requestAnimationFrame(draw);
        return;
      }
      lastDrawRef.current = time;
      const { width, height } = transformRef.current;
      context.clearRect(0, 0, width, height);

      // A quiet field of drifting dust gives the map depth without implying
      // that every visible particle is a ranked recommendation.
      for (let index = 0; index < 150; index += 1) {
        const seedX = ((index * 73) % 997) / 997;
        const seedY = ((index * 193) % 991) / 991;
        const drift = Math.sin(time * 0.00008 + index * 1.71) * 7;
        const x = seedX * width + drift;
        const y = seedY * height + Math.cos(time * 0.00006 + index) * 5;
        const alpha = 0.018 + ((index * 17) % 9) * 0.004;
        context.fillStyle = `rgba(225, 235, 220, ${alpha})`;
        context.beginPath();
        context.arc(x, y, index % 11 === 0 ? 0.8 : 0.42, 0, Math.PI * 2);
        context.fill();
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

      edges.forEach((edge, edgeIndex) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (!from || !to) return;
        const a = getPoint(from);
        const b = getPoint(to);
        const active = !focusId || edge.from === focusId || edge.to === focusId;
        const searchVisible = matches.has(edge.from) || matches.has(edge.to);
        const signalAlpha = edge.kind === 'affinity' ? 0.62 : 1;
        context.beginPath();
        context.moveTo(a.x, a.y);
        const bend = Math.sin((a.x + b.y) * 0.008) * 14;
        context.quadraticCurveTo((a.x + b.x) / 2 + bend, (a.y + b.y) / 2 - bend, b.x, b.y);
        if (focusId && active && searchVisible) {
          const gradient = context.createLinearGradient(a.x, a.y, b.x, b.y);
          gradient.addColorStop(0, `${from.color}${edge.kind === 'affinity' ? '26' : '42'}`);
          gradient.addColorStop(0.5, `rgba(220, 232, 216, ${(0.09 + edge.weight * 0.16) * signalAlpha})`);
          gradient.addColorStop(1, `${to.color}${edge.kind === 'affinity' ? '26' : '42'}`);
          context.strokeStyle = gradient;
        } else {
          const alpha = active && searchVisible ? (0.035 + edge.weight * 0.075) * signalAlpha : 0.018;
          context.strokeStyle = `rgba(214, 226, 210, ${alpha})`;
        }
        context.lineWidth = active ? 0.35 + edge.weight * 0.5 : 0.3;
        context.setLineDash(edge.kind === 'affinity' ? [1.2, 4.5] : []);
        context.stroke();
        context.setLineDash([]);

        if (edge.kind === 'evidence' && active && searchVisible && edge.weight > 0.52 && (focusId || edgeIndex % 7 === 0)) {
          const travel = (time * (0.000025 + edge.weight * 0.00002) + edge.weight) % 1;
          const oneMinus = 1 - travel;
          const controlX = (a.x + b.x) / 2 + bend;
          const controlY = (a.y + b.y) / 2 - bend;
          const particleX = oneMinus * oneMinus * a.x + 2 * oneMinus * travel * controlX + travel * travel * b.x;
          const particleY = oneMinus * oneMinus * a.y + 2 * oneMinus * travel * controlY + travel * travel * b.y;
          context.fillStyle = 'rgba(232, 244, 224, .42)';
          context.beginPath();
          context.arc(particleX, particleY, 0.75, 0, Math.PI * 2);
          context.fill();
        }
      });

      nodes.forEach((node, index) => {
        const point = getPoint(node);
        const hovered = hoverRef.current === node.id;
        const selected = selectedId === node.id;
        const related = !focusId || connected.has(node.id);
        const visible = matches.has(node.id);
        const pulse = 1 + Math.sin(time * 0.0008 + index * 0.7) * 0.08;
        const kindScale = node.kind === 'topic' ? 0.29 : node.kind === 'person' ? 0.25 : 0.2;
        const radius = Math.max(1.25, node.size * kindScale) * pulse * Math.sqrt(zoomRef.current) + (hovered || selected ? 1.8 : 0);

        context.globalAlpha = related && visible ? 1 : 0.17;
        const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 5.5);
        glow.addColorStop(0, `${node.color}${selected || hovered ? '68' : '32'}`);
        glow.addColorStop(1, `${node.color}00`);
        context.fillStyle = glow;
        context.beginPath();
        context.arc(point.x, point.y, radius * 5.5, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = node.color;
        context.beginPath();
        context.arc(point.x, point.y, Math.max(0.85, radius * 0.48), 0, Math.PI * 2);
        context.fill();

        if (node.kind === 'topic') {
          context.strokeStyle = `${node.color}${selected || hovered ? '99' : '50'}`;
          context.lineWidth = 0.55;
          context.beginPath();
          context.arc(point.x, point.y, radius * 1.4, 0, Math.PI * 2);
          context.stroke();
        }

        const showLabel = hovered || selected || (query.trim().length > 0 && visible) || (node.kind === 'topic' && node.size >= 13 && (!focusId || connected.has(node.id)));
        if (showLabel) {
          context.font = `${selected || hovered ? 580 : 430} ${selected || hovered ? 11 : 9.5}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          context.textAlign = 'center';
          context.fillStyle = visible && related ? 'rgba(244, 241, 233, .82)' : 'rgba(244,241,233,.2)';
          context.fillText(node.label, point.x, point.y + radius + 15);
        }
        context.globalAlpha = 1;
      });

      frameRef.current = requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    frameRef.current = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
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
      const point = getPoint(node);
      const distance = Math.hypot(point.x - x, point.y - y);
      const threshold = Math.max(18, node.size * 1.8);
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
      aria-label="Interactive graph of topics, people, bookmarks, and supplemental affinities"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerRef.current = { x: event.clientX, y: event.clientY, down: true, moved: false };
      }}
      onPointerMove={(event) => {
        const pointer = pointerRef.current;
        if (pointer.down) {
          const dx = event.clientX - pointer.x;
          const dy = event.clientY - pointer.y;
          panRef.current.x += dx;
          panRef.current.y += dy;
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
        if (!moved) onSelect(hitTest(event.clientX, event.clientY)?.id ?? null);
      }}
      onPointerLeave={() => {
        pointerRef.current.down = false;
        hoverRef.current = null;
      }}
      onWheel={(event) => {
        event.preventDefault();
        zoomRef.current = Math.min(2.35, Math.max(0.58, zoomRef.current - event.deltaY * 0.0009));
      }}
      onDoubleClick={() => {
        panRef.current = { x: 0, y: 0 };
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
  totals: { bookmark_count: number; author_count: number };
};

type ViewMode = 'map' | 'people' | 'threads' | 'bookmarks';

export default function Home() {
  const [selectedId, setSelectedId] = useState<string | null>('topic:generative-interfaces');
  const [query, setQuery] = useState('');
  const [connection, setConnection] = useState<ConnectionState>({ connected: false });
  const [graphNodes, setGraphNodes] = useState<StimNode[]>(demoNodes);
  const [graphEdges, setGraphEdges] = useState<Edge[]>(demoEdges);
  const [totals, setTotals] = useState<{ bookmark_count: number; author_count: number }>({
    bookmark_count: demoBookmarkSeeds.length,
    author_count: demoPeopleSeeds.length,
  });
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [view, setView] = useState<ViewMode>('map');
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [enrichState, setEnrichState] = useState<'idle' | 'enriching' | 'done' | 'error'>('idle');
  const [enrichMessage, setEnrichMessage] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const nodeById = useMemo(() => new Map(graphNodes.map((node) => [node.id, node])), [graphNodes]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
  const topicCount = graphNodes.filter((node) => node.kind === 'topic').length;
  const peopleCount = graphNodes.filter((node) => node.kind === 'person').length;
  const sourceCount = graphNodes.filter((node) => node.kind === 'source').length;
  const visibleNodes = useMemo(() => {
    if (view === 'people') return graphNodes.filter((node) => node.kind === 'person');
    if (view === 'threads') return graphNodes.filter((node) => node.kind === 'topic');
    if (view === 'bookmarks') return graphNodes.filter((node) => node.kind === 'source' || node.kind === 'person');
    return graphNodes;
  }, [graphNodes, view]);
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((node) => node.id));
    return graphEdges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  }, [graphEdges, visibleNodes]);

  const loadLiveGraph = useCallback(async () => {
    const response = await fetch('/api/graph', { cache: 'no-store' });
    if (!response.ok) return false;
    const data = (await response.json()) as GraphResponse;
    if (data.nodes.length === 0) return false;
    setGraphNodes(data.nodes);
    setGraphEdges(data.edges);
    setTotals(data.totals);
    setMode('live');
    setView('map');
    setSelectedId(data.nodes[0]?.id ?? null);
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/auth/x/status', { cache: 'no-store' })
      .then((response) => response.json() as Promise<ConnectionState>)
      .then(async (status) => {
        if (cancelled) return;
        setConnection(status);
        if (status.connected) {
          const loaded = await loadLiveGraph();
          if (!loaded && !cancelled) setSelectedId(null);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [loadLiveGraph]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement !== searchRef.current) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        setSelectedId(null);
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const syncBookmarks = async () => {
    setSyncState('syncing');
    setSyncMessage('Reading up to 600 bookmarks from X…');
    try {
      const response = await fetch('/api/bookmarks/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 600 }),
      });
      const result = (await response.json()) as { imported?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Sync failed.');
      await loadLiveGraph();
      setSyncState('done');
      setSyncMessage(`${result.imported ?? 0} bookmarks are now mapped locally.`);
    } catch (error) {
      setSyncState('error');
      setSyncMessage(error instanceof Error ? error.message : 'Sync failed.');
    }
  };

  const enrichBookmarks = async () => {
    setEnrichState('enriching');
    setEnrichMessage('Sending the next 40 bookmark texts and author handles to Grok…');
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
      await loadLiveGraph();
      setEnrichState('done');
      if (result.analyzed === 0) {
        setEnrichMessage(result.message ?? 'No new bookmarks need enrichment.');
      } else {
        const retention = result.zeroDataRetention ? ' · ZDR confirmed' : '';
        setEnrichMessage(`${result.analyzed ?? 0} bookmarks gained ${result.topics ?? 0} topic links · estimated $${(result.estimatedCostUsd ?? 0).toFixed(4)}${retention}`);
      }
    } catch (error) {
      setEnrichState('error');
      setEnrichMessage(error instanceof Error ? error.message : 'Grok enrichment failed.');
    }
  };

  const chooseView = (nextView: ViewMode) => {
    setView(nextView);
    if (nextView === 'map') return;
    const kind = nextView === 'people' ? 'person' : nextView === 'threads' ? 'topic' : 'source';
    const first = graphNodes.find((node) => node.kind === kind);
    setSelectedId(first?.id ?? null);
  };

  const rediscover = () => {
    setView('map');
    if (graphNodes.length === 0) return;
    const currentIndex = graphNodes.findIndex((node) => node.id === selectedId);
    const offset = 1 + Math.floor(Math.random() * Math.max(1, graphNodes.length - 1));
    setSelectedId(graphNodes[(Math.max(0, currentIndex) + offset) % graphNodes.length].id);
  };

  const disconnect = async () => {
    await fetch('/api/auth/x/disconnect', { method: 'POST' });
    setConnection({ connected: false });
    setGraphNodes(demoNodes);
    setGraphEdges(demoEdges);
    setTotals({ bookmark_count: demoBookmarkSeeds.length, author_count: demoPeopleSeeds.length });
    setMode('demo');
    setView('map');
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
          <span className="brand-mark" aria-hidden="true">S</span>
          <div>
            <p className="brand">STIMGRAPH</p>
            <p className="brand-expansion">Stuff That Interests Me</p>
          </div>
        </div>

        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a person, theme, or connection"
            aria-label="Search the graph"
          />
          <kbd>/</kbd>
        </label>

        <div className="topbar-actions">
          <span className={`demo-pill ${mode === 'live' ? 'live' : ''}`}>
            <i /> {mode === 'live' ? `${totals.bookmark_count} bookmarks` : 'Demo constellation'}
          </span>
          {connection.connected ? (
            <button className="connect-button sync-button" type="button" onClick={syncBookmarks} disabled={syncState === 'syncing'}>
              {syncState === 'syncing' ? 'Syncing…' : `Sync @${connection.profile?.username ?? 'X'}`}
            </button>
          ) : (
            <a className="connect-button" href="/api/auth/x/start">Connect X</a>
          )}
        </div>
      </header>

      <section className="workspace">
        <aside className="left-rail" aria-label="Graph navigation">
          <nav>
            <button className={`rail-item ${view === 'map' ? 'active' : ''}`} type="button" onClick={() => chooseView('map')}><span>⌘</span>Map</button>
            <button className={`rail-item ${view === 'people' ? 'active' : ''}`} type="button" onClick={() => chooseView('people')}><span>◎</span>People</button>
            <button className={`rail-item ${view === 'threads' ? 'active' : ''}`} type="button" onClick={() => chooseView('threads')}><span>↝</span>Threads</button>
            <button className={`rail-item ${view === 'bookmarks' ? 'active' : ''}`} type="button" onClick={() => chooseView('bookmarks')}><span>✦</span>Bookmarks</button>
            <button className="rail-item" type="button" onClick={rediscover}><span>◷</span>Rediscover</button>
          </nav>

          <div className="rail-summary">
            <p className="eyebrow">IN THE FIELD</p>
            <dl>
              <div><dt>Topics</dt><dd>{topicCount}</dd></div>
              <div><dt>People</dt><dd>{peopleCount}</dd></div>
              <div><dt>Bookmarks</dt><dd>{sourceCount}</dd></div>
            </dl>
          </div>

          <button className="permissions-link" type="button" onClick={() => setSelectedId(null)}>
            <span>◇</span>
            <span><b>Read-only by design</b><small>See what Stimgraph can access</small></span>
          </button>
        </aside>

        <div className="graph-stage">
          <div className="stage-heading">
            <p className="eyebrow">{mode === 'live' ? 'YOUR CONSTELLATION' : 'DEMO CONSTELLATION'}</p>
            <h1>Find the signal at the edge.</h1>
            <p>Bookmarks are evidence. Affinities are suggestions. Drag · zoom · follow.</p>
          </div>
          <div className="field-readout" aria-live="polite">
            <span>{visibleNodes.length} signals</span>
            <i />
            <span>{visibleEdges.length} connections</span>
          </div>
          <GraphCanvas nodes={visibleNodes} edges={visibleEdges} selectedId={selectedId} query={query} onSelect={setSelectedId} />
          <div className="legend" aria-label="Graph legend">
            <span><i className="topic-dot" />Topic</span>
            <span><i className="person-dot" />Person</span>
            <span><i className="source-dot" />Bookmark</span>
            <span className="affinity-key"><i />Affinity</span>
          </div>
        </div>

        <aside className="inspector" aria-live="polite">
          {selected ? (
            <>
              <div className="inspector-topline">
                <span className={`kind-badge ${selected.kind}`}>{selected.kind === 'source' ? 'bookmark' : selected.kind}</span>
                <button type="button" onClick={() => setSelectedId(null)} aria-label="Close details">×</button>
              </div>
              <div className="selected-orb" style={{ '--orb-color': selected.color } as React.CSSProperties} />
              <h2>{selected.label}</h2>
              <p className="inspector-note">{selected.note}</p>
              {selected.url ? <a className="node-link" href={selected.url} target="_blank" rel="noreferrer">Open on X ↗</a> : null}

              <div className="evidence-card">
                <div>
                  <span>WHY IT APPEARS</span>
                  <strong>{selected.evidence}</strong>
                </div>
                <span className="source-chip">{mode === 'live' ? 'Traceable' : 'Demo data'}</span>
              </div>

              <div className="connections-list">
                <p className="eyebrow">NEARBY SIGNALS</p>
                {graphEdges
                  .filter((edge) => edge.from === selected.id || edge.to === selected.id)
                  .sort((first, second) => second.weight - first.weight)
                  .slice(0, 8)
                  .map((edge) => {
                    const neighbor = nodeById.get(edge.from === selected.id ? edge.to : edge.from);
                    if (!neighbor) return null;
                    return (
                      <button key={neighbor.id} type="button" onClick={() => setSelectedId(neighbor.id)}>
                        <i style={{ background: neighbor.color }} />
                        <span>{neighbor.label}</span>
                        <b>{edge.kind === 'affinity' ? 'affinity' : `${Math.round(edge.weight * 100)}%`}</b>
                      </button>
                    );
                  })}
                <small>Solid lines come from bookmarks. Dotted lines show shared patterns. The dotted lines do not change the ranking.</small>
              </div>
            </>
          ) : (
            <div className="permissions-panel">
              <span className="permission-icon">◇</span>
              <p className="eyebrow">{connection.connected ? 'X CONNECTED' : 'PERMISSIONS PREVIEW'}</p>
              <h2>{connection.connected ? `Ready, @${connection.profile?.username}.` : 'You choose what enters the map.'}</h2>
              <p>{connection.connected
                ? 'Your token is encrypted in an HTTP-only browser cookie. Choose when to read bookmarks; nothing is imported automatically.'
                : 'Stimgraph asks X for four read-only permissions. It cannot post, like, follow, or change your bookmarks.'}</p>
              <ul>
                <li><b>Bookmarks</b><span>Read saved posts only when you press Sync</span></li>
                <li><b>Posts</b><span>Read the content you saved</span></li>
                <li><b>Profiles</b><span>Name the people in your map</span></li>
                <li><b>Offline access</b><span>Refresh when you ask it to sync</span></li>
              </ul>
              {connection.connected ? (
                <button className="wide-connect" type="button" onClick={syncBookmarks} disabled={syncState === 'syncing'}>
                  {syncState === 'syncing' ? 'Syncing…' : 'Sync up to 600 bookmarks'}
                </button>
              ) : (
                <a className="wide-connect" href="/api/auth/x/start">Review and connect X</a>
              )}
              {syncMessage ? <p className={`sync-message ${syncState}`}>{syncMessage}</p> : null}
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

              {connection.connected ? (
                <section className="data-controls" aria-label="Local data controls">
                  <p className="eyebrow">DATA CONTROLS</p>
                  <button type="button" onClick={disconnect}>Disconnect browser session</button>
                  <button className="danger-link" type="button" onClick={deleteLocalData}>Delete local map + disconnect</button>
                  <small>Disconnecting leaves your local map in place. Deleting removes it from this app. Revoke the app itself from X account settings if you also want to withdraw X consent.</small>
                </section>
              ) : null}
            </div>
          )}
          <footer className="inspiration-credit">
            Interaction inspiration: <a href="https://x.com/poetengineer__/status/1821654144958202077" target="_blank" rel="noreferrer">Kat ⊷ the Poet Engineer’s gestural latent-space work</a>. Stimgraph’s design and implementation are original.
          </footer>
        </aside>
      </section>
    </main>
  );
}
