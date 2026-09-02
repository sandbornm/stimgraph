import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadGraph } from '@/db/storage';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';

export const dynamic = 'force-dynamic';

const topicColors = ['#d7ff72', '#72e7ff', '#ff8f70', '#ffcf66', '#b39cff', '#8de4bb'];

function hashUnit(value: string, salt = 0) {
  let hash = 2166136261 + salt;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function fieldPosition(id: string, kind: 'topic' | 'person', index: number, count: number) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const progress = Math.sqrt((index + 0.65) / Math.max(1, count));
  const radius = kind === 'topic' ? 0.055 + progress * 0.25 : 0.27 + progress * 0.2;
  const angle = index * goldenAngle + hashUnit(id, 7) * 0.55;
  const yScale = kind === 'topic' ? 0.82 : 0.74;
  return {
    x: 0.5 + Math.cos(angle) * radius,
    y: 0.5 + Math.sin(angle) * radius * yScale,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sourceLabel(text: string) {
  const cleaned = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Saved post';
  return cleaned.length > 58 ? `${cleaned.slice(0, 57).trim()}…` : cleaned;
}

export async function GET(request: NextRequest) {
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ error: 'Connect X first.' }, { status: 401 });

  const scope = request.nextUrl.searchParams.get('scope') === 'wide' ? 'wide' : 'overview';
  const data = await loadGraph(active.session.profile.id, scope);
  const topicNodes = data.topics.map((topic, index) => ({
    id: `topic:${topic.id}`,
    label: topic.label,
    kind: 'topic' as const,
    ...fieldPosition(topic.id, 'topic', index, data.topics.length),
    size: Math.min(18, 8 + Math.sqrt(Number(topic.bookmark_count)) * 2),
    color: topicColors[index % topicColors.length],
    note: `Appears in ${topic.bookmark_count} saved post${Number(topic.bookmark_count) === 1 ? '' : 's'}.`,
    evidence: `${topic.bookmark_count} bookmarks · ${topic.source}`,
  }));
  const followedIds = new Set(data.follows.map((follow) => follow.user_id));
  const authorIds = new Set(data.authors.map((author) => author.author_id));
  const followOnly = data.follows.filter((follow) => !authorIds.has(follow.user_id));
  const peopleCount = data.authors.length + followOnly.length;
  const authorNodes = [
    ...data.authors.map((author, index) => {
      const followed = followedIds.has(author.author_id);
      return {
        id: `person:${author.author_id}`,
        label: `${author.author_name} · @${author.author_username}`,
        kind: 'person' as const,
        ...fieldPosition(author.author_id, 'person', index, peopleCount),
        size: Math.min(13, (followed ? 5.6 : 5) + Math.sqrt(Number(author.bookmark_count)) * 1.35),
        color: '#f4f1e9',
        note: followed
          ? `You follow @${author.author_username}. They authored ${author.bookmark_count} of your saved posts.`
          : `@${author.author_username} authored ${author.bookmark_count} of your saved posts. Follow the surrounding particles to see what placed them here.`,
        evidence: followed
          ? `${author.bookmark_count} bookmarks · Following`
          : `${author.bookmark_count} bookmarks · From X`,
        url: `https://x.com/${author.author_username}`,
        followed,
      };
    }),
    ...followOnly.map((follow, index) => ({
      id: `person:${follow.user_id}`,
      label: `${follow.name} · @${follow.username}`,
      kind: 'person' as const,
      ...fieldPosition(follow.user_id, 'person', data.authors.length + index, peopleCount),
      size: 5.4,
      color: '#8f9888',
      note: follow.description
        ? `You follow @${follow.username}. No saved posts from them yet. ${follow.description}`
        : `You follow @${follow.username}. No saved posts from them yet.`,
      evidence: 'Following · From X',
      url: `https://x.com/${follow.username}`,
      followed: true,
    })),
  ];
  const authorById = new Map(authorNodes.map((node) => [node.id.slice('person:'.length), node]));
  const sourceNodes = data.bookmarks.map((bookmark) => {
    const author = authorById.get(bookmark.author_id);
    const angle = hashUnit(bookmark.post_id, 19) * Math.PI * 2;
    const distance = 0.045 + hashUnit(bookmark.post_id, 31) * 0.09;
    const anchor = author ?? { x: 0.5, y: 0.5 };
    return {
      id: `bookmark:${bookmark.post_id}`,
      label: sourceLabel(bookmark.text),
      kind: 'source' as const,
      x: clamp(anchor.x + Math.cos(angle) * distance, 0.045, 0.955),
      y: clamp(anchor.y + Math.sin(angle) * distance * 0.72, 0.05, 0.95),
      size: 3 + hashUnit(bookmark.post_id, 47) * 1.8,
      color: '#96a39a',
      note: bookmark.text.slice(0, 320),
      evidence: `Saved from @${bookmark.author_username}${bookmark.created_at ? ` · ${new Date(bookmark.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}` : ''}`,
      url: `https://x.com/${bookmark.author_username}/status/${bookmark.post_id}`,
    };
  });
  const topicById = new Map(topicNodes.map((node) => [node.id.slice('topic:'.length), node]));
  const scoutNodes = data.scouts.map((scout) => {
    const topic = scout.topic_id ? topicById.get(scout.topic_id) : undefined;
    const angle = hashUnit(scout.post_id, 23) * Math.PI * 2;
    const distance = 0.11 + hashUnit(scout.post_id, 41) * 0.08;
    const anchor = topic ?? { x: 0.5, y: 0.5 };
    return {
      id: `scout:${scout.post_id}`,
      label: sourceLabel(scout.text),
      kind: 'scout' as const,
      x: clamp(anchor.x + Math.cos(angle) * distance, 0.04, 0.96),
      y: clamp(anchor.y + Math.sin(angle) * distance * 0.7, 0.05, 0.95),
      size: 4.2 + hashUnit(scout.post_id, 11) * 1.4,
      color: '#7ee0ff',
      note: scout.text.slice(0, 320),
      evidence: `Scouted · ${scout.topic_label} · ${scout.confidence}% · ${scout.reason}`,
      url: scout.url ?? `https://x.com/${scout.author_username}/status/${scout.post_id}`,
    };
  });
  const available = new Set([...topicNodes, ...authorNodes, ...sourceNodes, ...scoutNodes].map((node) => node.id));
  const authorTopicEdges = data.connections
    .map((connection) => ({
      from: `person:${connection.author_id}`,
      to: `topic:${connection.topic_id}`,
      weight: Math.min(1, 0.25 + Number(connection.connection_count) / 5),
      kind: 'evidence' as const,
    }))
    .filter((edge) => available.has(edge.from) && available.has(edge.to));
  const bookmarkAuthorEdges = data.bookmarks
    .map((bookmark) => ({
      from: `bookmark:${bookmark.post_id}`,
      to: `person:${bookmark.author_id}`,
      weight: 0.38,
      kind: 'evidence' as const,
    }))
    .filter((edge) => available.has(edge.from) && available.has(edge.to));
  const bookmarkTopicEdges = data.bookmarkTopics
    .map((connection) => ({
      from: `bookmark:${connection.post_id}`,
      to: `topic:${connection.topic_id}`,
      weight: Math.min(0.82, 0.28 + Number(connection.confidence) / 180),
      kind: 'evidence' as const,
    }))
    .filter((edge) => available.has(edge.from) && available.has(edge.to));
  const topicAffinityEdges = data.topicAffinities
    .map((connection) => ({
      from: `topic:${connection.first_topic_id}`,
      to: `topic:${connection.second_topic_id}`,
      weight: Math.min(0.72, 0.18 + Number(connection.shared_bookmarks) / 12),
      kind: 'affinity' as const,
    }))
    .filter((edge) => available.has(edge.from) && available.has(edge.to));
  const authorAffinityEdges = data.authorAffinities
    .map((connection) => ({
      from: `person:${connection.first_author_id}`,
      to: `person:${connection.second_author_id}`,
      weight: Math.min(0.64, 0.14 + Number(connection.shared_topics) / 15),
      kind: 'affinity' as const,
    }))
    .filter((edge) => available.has(edge.from) && available.has(edge.to));
  const scoutTopicEdges = data.scouts
    .map((scout) => ({
      from: `scout:${scout.post_id}`,
      to: `topic:${scout.topic_id}`,
      weight: Math.min(0.78, 0.34 + Number(scout.confidence) / 220),
      kind: 'affinity' as const,
    }))
    .filter((edge) => available.has(edge.from) && available.has(edge.to));

  return withRenewedSession(NextResponse.json({
    nodes: [...topicNodes, ...authorNodes, ...sourceNodes, ...scoutNodes],
    edges: [...authorTopicEdges, ...bookmarkAuthorEdges, ...bookmarkTopicEdges, ...topicAffinityEdges, ...authorAffinityEdges, ...scoutTopicEdges],
    totals: data.totals,
    scope,
    profile: active.session.profile,
  }), active.renewedCookie);
}
