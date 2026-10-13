import { getD1 } from './index';
import { ACTIVITY_SCHEMA } from './activity';
import { withOwnerWork } from '@/lib/owner-work';
import { parseCapsule, type GraphCapsule } from '@/lib/capsule';
import type { FeedProbe } from '@/lib/rss-probe';
import { hostFromUrl, urlsFromBookmark } from '@/lib/rss-probe';
import type { StoredFollow } from '@/lib/x-following';
import type { XProfile } from '@/lib/x-session';

export type StoredBookmark = {
  postId: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorProfileImageUrl?: string;
  text: string;
  createdAt?: string;
  language?: string;
  entities: Record<string, unknown>;
  metrics: Record<string, unknown>;
  hashtags: string[];
};

export type BookmarkForEnrichment = {
  postId: string;
  authorUsername: string;
  text: string;
};

export type AiTopicAssignment = {
  postId: string;
  topics: Array<{
    label: string;
    reason: string;
    confidence: number;
  }>;
};

export type StoredScout = {
  postId: string;
  authorUsername: string;
  authorName: string;
  text: string;
  url: string;
  topicId: string;
  topicLabel: string;
  reason: string;
  confidence: number;
};

let initialized = false;

export async function ensureSchema() {
  if (initialized) return;
  const d1 = getD1();
  await d1.batch([
    ...ACTIVITY_SCHEMA.map((sql) => d1.prepare(sql)),
    d1.prepare(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      profile_image_url TEXT,
      connected_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS bookmarks (
      owner_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_username TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_profile_image_url TEXT,
      text TEXT NOT NULL,
      created_at TEXT,
      language TEXT,
      entities_json TEXT NOT NULL DEFAULT '{}',
      metrics_json TEXT NOT NULL DEFAULT '{}',
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, post_id)
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS topics (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, id)
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS bookmark_topics (
      owner_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 100,
      evidence TEXT NOT NULL,
      source TEXT NOT NULL,
      PRIMARY KEY (owner_id, post_id, topic_id)
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS follows (
      owner_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      profile_image_url TEXT,
      description TEXT,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, user_id)
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS scouts (
      owner_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      author_username TEXT NOT NULL,
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      url TEXT,
      topic_id TEXT,
      topic_label TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence INTEGER NOT NULL DEFAULT 70,
      scouted_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, post_id)
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS feeds (
      owner_id TEXT NOT NULL,
      host TEXT NOT NULL,
      page_url TEXT NOT NULL,
      feeds_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      error TEXT,
      probed_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, host)
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      capsule_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS oauth_pending (
      state TEXT PRIMARY KEY NOT NULL,
      verifier TEXT NOT NULL,
      return_path TEXT,
      created_at INTEGER NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS trajectories (
      owner_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      question TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, id)
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS bridge_requests (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_bridge_requests_owner_created ON bridge_requests(owner_id, created_at)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_trajectories_owner_created ON trajectories(owner_id, created_at)'),
    d1.prepare(`CREATE TABLE IF NOT EXISTS research_cards (
      owner_id TEXT NOT NULL, id TEXT NOT NULL, card_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, id)
    )`),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_research_cards_owner_created ON research_cards(owner_id, created_at)'),
    d1.prepare(`CREATE TABLE IF NOT EXISTS research_requests (
      id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_research_requests_owner_kind_created ON research_requests(owner_id, kind, created_at)'),
    d1.prepare(`CREATE TABLE IF NOT EXISTS x_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_bookmarks_owner_author ON bookmarks(owner_id, author_id)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_bookmarks_owner_created ON bookmarks(owner_id, created_at)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_topics_owner_label ON topics(owner_id, label)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_bookmark_topics_owner_topic ON bookmark_topics(owner_id, topic_id)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_scouts_owner_scouted ON scouts(owner_id, scouted_at)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_follows_owner_username ON follows(owner_id, username)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_feeds_owner_status ON feeds(owner_id, status)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_shares_owner_created ON shares(owner_id, created_at)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_x_sessions_owner ON x_sessions(owner_id)'),
  ]);
  initialized = true;
}

const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;
export const X_SESSION_TTL_MS = 60 * 60 * 24 * 180 * 1000;

export async function saveOauthPending(state: string, verifier: string, returnPath: string | null) {
  await ensureSchema();
  const d1 = getD1();
  const now = Date.now();
  await d1.batch([
    d1.prepare('DELETE FROM oauth_pending WHERE created_at < ?').bind(now - OAUTH_PENDING_TTL_MS),
    d1.prepare(
      'INSERT INTO oauth_pending (state, verifier, return_path, created_at) VALUES (?, ?, ?, ?)',
    ).bind(state, verifier, returnPath, now),
  ]);
}

export async function takeOauthPending(state: string): Promise<{ verifier: string; returnPath: string | null } | null> {
  await ensureSchema();
  const d1 = getD1();
  const row = await d1.prepare(
    'SELECT verifier, return_path, created_at FROM oauth_pending WHERE state = ?',
  ).bind(state).first<{ verifier: string; return_path: string | null; created_at: number }>();
  await d1.prepare('DELETE FROM oauth_pending WHERE state = ?').bind(state).run();
  if (!row || row.created_at < Date.now() - OAUTH_PENDING_TTL_MS) return null;
  return { verifier: row.verifier, returnPath: row.return_path };
}

export async function replaceXSessionRecord(id: string, ownerId: string, payload: string, expiresAt: number) {
  await ensureSchema();
  const d1 = getD1();
  const now = Date.now();
  await d1.batch([
    d1.prepare('DELETE FROM x_sessions WHERE owner_id = ?').bind(ownerId),
    d1.prepare(
      'INSERT INTO x_sessions (id, owner_id, payload, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, ownerId, payload, expiresAt, now, now),
  ]);
}

export async function saveXSessionRecord(id: string, ownerId: string, payload: string, expiresAt: number) {
  await ensureSchema();
  const now = Date.now();
  // Do not resurrect a session that was disconnected while a refresh was running.
  await getD1().prepare(`UPDATE x_sessions SET payload = ?, expires_at = ?, updated_at = ?
    WHERE id = ? AND owner_id = ?`).bind(payload, expiresAt, now, id, ownerId).run();
}

export async function loadXSessionRecord(id: string): Promise<{ payload: string; ownerId: string; expiresAt: number } | null> {
  await ensureSchema();
  const row = await getD1().prepare(
    'SELECT payload, owner_id, expires_at FROM x_sessions WHERE id = ?',
  ).bind(id).first<{ payload: string; owner_id: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await deleteXSessionRecord(id);
    return null;
  }
  return { payload: row.payload, ownerId: row.owner_id, expiresAt: row.expires_at };
}

export async function deleteXSessionRecord(id: string) {
  await ensureSchema();
  await getD1().prepare('DELETE FROM x_sessions WHERE id = ?').bind(id).run();
}

function topicId(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
}

async function existingBookmarkIds(ownerId: string, postIds: string[]) {
  if (postIds.length === 0) return new Set<string>();
  await ensureSchema();
  const d1 = getD1();
  const found = new Set<string>();
  for (let index = 0; index < postIds.length; index += 80) {
    const slice = postIds.slice(index, index + 80);
    const placeholders = slice.map(() => '?').join(',');
    const result = await d1.prepare(
      `SELECT post_id FROM bookmarks WHERE owner_id = ? AND post_id IN (${placeholders})`,
    ).bind(ownerId, ...slice).all<{ post_id: string }>();
    for (const row of result.results) found.add(row.post_id);
  }
  return found;
}

export async function storeBookmarks({
  owner,
  bookmarks,
  optimize = true,
  skipUnchanged = false,
}: {
  owner: XProfile;
  bookmarks: StoredBookmark[];
  optimize?: boolean;
  skipUnchanged?: boolean;
}) {
  await ensureSchema();
  const d1 = getD1();
  const now = Date.now();
  const already = await existingBookmarkIds(owner.id, bookmarks.map((bookmark) => bookmark.postId));
  const insertedIds = bookmarks.filter((bookmark) => !already.has(bookmark.postId)).map((bookmark) => bookmark.postId);
  if (skipUnchanged && insertedIds.length === 0) {
    return { stored: bookmarks.length, inserted: 0, insertedIds };
  }
  const statements: D1PreparedStatement[] = [
    d1.prepare(`INSERT INTO accounts (id, username, name, profile_image_url, connected_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        name = excluded.name,
        profile_image_url = excluded.profile_image_url,
        updated_at = excluded.updated_at`)
      .bind(owner.id, owner.username, owner.name, owner.profileImageUrl ?? null, now, now),
  ];
  const batchEnds: number[] = [];

  for (const bookmark of bookmarks) {
    statements.push(
      d1.prepare(`INSERT INTO bookmarks (
        owner_id, post_id, author_id, author_username, author_name,
        author_profile_image_url, text, created_at, language,
        entities_json, metrics_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, post_id) DO UPDATE SET
        author_id = excluded.author_id,
        author_username = excluded.author_username,
        author_name = excluded.author_name,
        author_profile_image_url = excluded.author_profile_image_url,
        text = excluded.text,
        created_at = excluded.created_at,
        language = excluded.language,
        entities_json = excluded.entities_json,
        metrics_json = excluded.metrics_json,
        synced_at = excluded.synced_at`)
        .bind(
          owner.id,
          bookmark.postId,
          bookmark.authorId,
          bookmark.authorUsername,
          bookmark.authorName,
          bookmark.authorProfileImageUrl ?? null,
          bookmark.text,
          bookmark.createdAt ?? null,
          bookmark.language ?? null,
          JSON.stringify(bookmark.entities),
          JSON.stringify(bookmark.metrics),
          now,
        ),
    );

    // The timestamp is when this app first saw the bookmark, never the post date.
    // Unique ownership/post keys make repeats and concurrent imports idempotent.
    statements.push(d1.prepare(`INSERT OR IGNORE INTO bookmark_observations
      (owner_id, post_id, observed_at) VALUES (?, ?, ?)`)
      .bind(owner.id, bookmark.postId, now));

    for (const hashtag of bookmark.hashtags) {
      const id = topicId(hashtag);
      if (!id) continue;
      statements.push(
        d1.prepare(`INSERT INTO topics (owner_id, id, label, source, created_at)
          VALUES (?, ?, ?, 'hashtag', ?)
          ON CONFLICT(owner_id, id) DO UPDATE SET label = excluded.label`)
          .bind(owner.id, id, hashtag, now),
        d1.prepare(`INSERT INTO bookmark_topics (owner_id, post_id, topic_id, confidence, evidence, source)
          VALUES (?, ?, ?, 100, ?, 'hashtag')
          ON CONFLICT(owner_id, post_id, topic_id) DO UPDATE SET evidence = excluded.evidence`)
          .bind(owner.id, bookmark.postId, id, `#${hashtag}`),
      );
    }
    batchEnds.push(statements.length);
  }

  let batchStart = 0;
  for (const end of batchEnds) {
    if (end - batchStart < 80) continue;
    await d1.batch(statements.slice(batchStart, end));
    batchStart = end;
  }
  if (batchStart < statements.length) await d1.batch(statements.slice(batchStart));
  if (optimize) await d1.prepare('PRAGMA optimize').run();
  return { stored: bookmarks.length, inserted: insertedIds.length, insertedIds };
}

export async function storeFollows({
  ownerId,
  follows,
}: {
  ownerId: string;
  follows: StoredFollow[];
}) {
  await ensureSchema();
  const d1 = getD1();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    d1.prepare('DELETE FROM follows WHERE owner_id = ?').bind(ownerId),
  ];
  for (const follow of follows) {
    statements.push(
      d1.prepare(`INSERT INTO follows (
        owner_id, user_id, username, name, profile_image_url, description, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, user_id) DO UPDATE SET
        username = excluded.username,
        name = excluded.name,
        profile_image_url = excluded.profile_image_url,
        description = excluded.description,
        synced_at = excluded.synced_at`)
        .bind(
          ownerId,
          follow.userId,
          follow.username,
          follow.name,
          follow.profileImageUrl ?? null,
          follow.description ?? null,
          now,
        ),
    );
  }
  for (let index = 0; index < statements.length; index += 80) {
    await d1.batch(statements.slice(index, index + 80));
  }
  return { stored: follows.length };
}

type AuthorRow = {
  author_id: string;
  author_username: string;
  author_name: string;
  author_profile_image_url: string | null;
  bookmark_count: number;
};

type TopicRow = {
  id: string;
  label: string;
  source: string;
  bookmark_count: number;
};

type ConnectionRow = {
  author_id: string;
  topic_id: string;
  connection_count: number;
};

type BookmarkRow = {
  post_id: string;
  author_id: string;
  author_username: string;
  author_name: string;
  text: string;
  created_at: string | null;
};

type BookmarkTopicRow = {
  post_id: string;
  topic_id: string;
  confidence: number;
};

type TopicAffinityRow = {
  first_topic_id: string;
  second_topic_id: string;
  shared_bookmarks: number;
};

type AuthorAffinityRow = {
  first_author_id: string;
  second_author_id: string;
  shared_topics: number;
};

type FollowRow = {
  user_id: string;
  username: string;
  name: string;
  profile_image_url: string | null;
  description: string | null;
};

type ScoutRow = {
  post_id: string;
  author_username: string;
  author_name: string;
  text: string;
  url: string | null;
  topic_id: string | null;
  topic_label: string;
  reason: string;
  confidence: number;
  scouted_at: number;
};

export async function loadGraph(ownerId: string, scope: 'overview' | 'wide' = 'overview') {
  await ensureSchema();
  const d1 = getD1();
  const limits = scope === 'wide'
    ? { authors: 140, topics: 80, connections: 1200, bookmarks: 240, bookmarkTopics: 1500, topicAffinities: 300, authorAffinities: 280, scouts: 80, follows: 140 }
    : { authors: 90, topics: 50, connections: 600, bookmarks: 160, bookmarkTopics: 800, topicAffinities: 180, authorAffinities: 160, scouts: 48, follows: 80 };
  const [authors, topics, connections, bookmarkRows, bookmarkTopics, topicAffinities, authorAffinities, totals, scoutRows, followRows] = await d1.batch([
    d1.prepare(`SELECT author_id, author_username, author_name, author_profile_image_url,
      COUNT(*) AS bookmark_count
      FROM bookmarks WHERE owner_id = ?
      GROUP BY author_id, author_username, author_name, author_profile_image_url
      ORDER BY bookmark_count DESC LIMIT ?`).bind(ownerId, limits.authors),
    d1.prepare(`SELECT t.id, t.label, t.source, COUNT(bt.post_id) AS bookmark_count
      FROM topics t
      JOIN bookmark_topics bt ON bt.owner_id = t.owner_id AND bt.topic_id = t.id
      WHERE t.owner_id = ?
      GROUP BY t.id, t.label, t.source
      ORDER BY bookmark_count DESC LIMIT ?`).bind(ownerId, limits.topics),
    d1.prepare(`SELECT b.author_id, bt.topic_id, COUNT(*) AS connection_count
      FROM bookmarks b
      JOIN bookmark_topics bt ON bt.owner_id = b.owner_id AND bt.post_id = b.post_id
      WHERE b.owner_id = ?
      GROUP BY b.author_id, bt.topic_id
      ORDER BY connection_count DESC LIMIT ?`).bind(ownerId, limits.connections),
    d1.prepare(`SELECT post_id, author_id, author_username, author_name, text, created_at
      FROM bookmarks
      WHERE owner_id = ?
      ORDER BY created_at DESC, synced_at DESC
      LIMIT ?`).bind(ownerId, limits.bookmarks),
    d1.prepare(`SELECT bt.post_id, bt.topic_id, bt.confidence
      FROM bookmark_topics bt
      JOIN bookmarks b ON b.owner_id = bt.owner_id AND b.post_id = bt.post_id
      WHERE bt.owner_id = ?
      ORDER BY b.created_at DESC, bt.confidence DESC
      LIMIT ?`).bind(ownerId, limits.bookmarkTopics),
    d1.prepare(`SELECT
        first.topic_id AS first_topic_id,
        second.topic_id AS second_topic_id,
        COUNT(*) AS shared_bookmarks
      FROM bookmark_topics first
      JOIN bookmark_topics second
        ON second.owner_id = first.owner_id
        AND second.post_id = first.post_id
        AND second.topic_id > first.topic_id
      WHERE first.owner_id = ?
      GROUP BY first.topic_id, second.topic_id
      HAVING COUNT(*) >= 1
      ORDER BY shared_bookmarks DESC
      LIMIT ?`).bind(ownerId, limits.topicAffinities),
    d1.prepare(`WITH author_topics AS (
        SELECT b.author_id, bt.topic_id
        FROM bookmarks b
        JOIN bookmark_topics bt ON bt.owner_id = b.owner_id AND bt.post_id = b.post_id
        WHERE b.owner_id = ?
        GROUP BY b.author_id, bt.topic_id
      )
      SELECT
        first.author_id AS first_author_id,
        second.author_id AS second_author_id,
        COUNT(*) AS shared_topics
      FROM author_topics first
      JOIN author_topics second
        ON second.topic_id = first.topic_id
        AND second.author_id > first.author_id
      GROUP BY first.author_id, second.author_id
      HAVING COUNT(*) >= 1
      ORDER BY shared_topics DESC
      LIMIT ?`).bind(ownerId, limits.authorAffinities),
    d1.prepare(`SELECT
        (SELECT COUNT(*) FROM bookmarks WHERE owner_id = ?) AS bookmark_count,
        (SELECT COUNT(DISTINCT author_id) FROM bookmarks WHERE owner_id = ?) AS author_count,
        (SELECT COUNT(*) FROM scouts WHERE owner_id = ?) AS scout_count,
        (SELECT COUNT(*) FROM follows WHERE owner_id = ?) AS following_count`)
      .bind(ownerId, ownerId, ownerId, ownerId),
    d1.prepare(`SELECT post_id, author_username, author_name, text, url, topic_id, topic_label, reason, confidence, scouted_at
      FROM scouts WHERE owner_id = ?
      ORDER BY scouted_at DESC LIMIT ?`).bind(ownerId, limits.scouts),
    d1.prepare(`SELECT user_id, username, name, profile_image_url, description
      FROM follows WHERE owner_id = ?
      ORDER BY username COLLATE NOCASE
      LIMIT ?`).bind(ownerId, limits.follows),
  ]);

  return {
    authors: authors.results as unknown as AuthorRow[],
    topics: topics.results as unknown as TopicRow[],
    connections: connections.results as unknown as ConnectionRow[],
    bookmarks: bookmarkRows.results as unknown as BookmarkRow[],
    bookmarkTopics: bookmarkTopics.results as unknown as BookmarkTopicRow[],
    topicAffinities: topicAffinities.results as unknown as TopicAffinityRow[],
    authorAffinities: authorAffinities.results as unknown as AuthorAffinityRow[],
    scouts: scoutRows.results as unknown as ScoutRow[],
    follows: followRows.results as unknown as FollowRow[],
    totals: {
      bookmark_count: Number((totals.results[0] as { bookmark_count?: number; author_count?: number; scout_count?: number; following_count?: number } | undefined)?.bookmark_count ?? 0),
      author_count: Number((totals.results[0] as { bookmark_count?: number; author_count?: number; scout_count?: number; following_count?: number } | undefined)?.author_count ?? 0),
      scout_count: Number((totals.results[0] as { bookmark_count?: number; author_count?: number; scout_count?: number; following_count?: number } | undefined)?.scout_count ?? 0),
      following_count: Number((totals.results[0] as { bookmark_count?: number; author_count?: number; scout_count?: number; following_count?: number } | undefined)?.following_count ?? 0),
    },
  };
}

export async function loadBookmarksForEnrichment(ownerId: string, limit: number) {
  await ensureSchema();
  const result = await getD1().prepare(`SELECT
      b.post_id AS postId,
      b.author_username AS authorUsername,
      b.text AS text
    FROM bookmarks b
    WHERE b.owner_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM bookmark_topics bt
        WHERE bt.owner_id = b.owner_id
          AND bt.post_id = b.post_id
          AND bt.source IN ('grok', 'mixed')
      )
    ORDER BY b.created_at DESC, b.synced_at DESC
    LIMIT ?`)
    .bind(ownerId, limit)
    .all<BookmarkForEnrichment>();
  return result.results;
}

export async function storeAiTopics(ownerId: string, assignments: AiTopicAssignment[]) {
  await ensureSchema();
  const d1 = getD1();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];

  for (const assignment of assignments) {
    for (const topic of assignment.topics.slice(0, 4)) {
      const label = topic.label.replace(/\s+/g, ' ').trim().slice(0, 48);
      const id = topicId(label);
      if (!id) continue;
      const reason = topic.reason.replace(/\s+/g, ' ').trim().slice(0, 180);
      const confidence = Math.max(0, Math.min(100, Math.round(topic.confidence)));
      statements.push(
        d1.prepare(`INSERT INTO topics (owner_id, id, label, source, created_at)
          VALUES (?, ?, ?, 'grok', ?)
          ON CONFLICT(owner_id, id) DO UPDATE SET
            label = excluded.label,
            source = CASE WHEN topics.source = 'grok' THEN 'grok' ELSE 'mixed' END`)
          .bind(ownerId, id, label, now),
        d1.prepare(`INSERT INTO bookmark_topics (
            owner_id, post_id, topic_id, confidence, evidence, source
          ) VALUES (?, ?, ?, ?, ?, 'grok')
          ON CONFLICT(owner_id, post_id, topic_id) DO UPDATE SET
            confidence = MAX(bookmark_topics.confidence, excluded.confidence),
            evidence = excluded.evidence,
            source = CASE WHEN bookmark_topics.source = 'grok' THEN 'grok' ELSE 'mixed' END`)
          .bind(ownerId, assignment.postId, id, confidence, reason),
      );
    }
  }

  for (let index = 0; index < statements.length; index += 80) {
    await d1.batch(statements.slice(index, index + 80));
  }
  return statements.length / 2;
}

export async function loadScoutContext(ownerId: string) {
  await ensureSchema();
  const d1 = getD1();
  const [topics, authors, follows, bookmarks, scouts] = await d1.batch([
    d1.prepare(`SELECT t.id, t.label
      FROM topics t
      JOIN bookmark_topics bt ON bt.owner_id = t.owner_id AND bt.topic_id = t.id
      WHERE t.owner_id = ?
      GROUP BY t.id, t.label
      ORDER BY COUNT(bt.post_id) DESC LIMIT 10`).bind(ownerId),
    d1.prepare(`SELECT author_username
      FROM bookmarks WHERE owner_id = ?
      GROUP BY author_username
      ORDER BY COUNT(*) DESC LIMIT 12`).bind(ownerId),
    d1.prepare(`SELECT username FROM follows WHERE owner_id = ? ORDER BY username COLLATE NOCASE LIMIT 8`).bind(ownerId),
    d1.prepare(`SELECT post_id FROM bookmarks WHERE owner_id = ? ORDER BY synced_at DESC LIMIT 80`).bind(ownerId),
    d1.prepare(`SELECT post_id FROM scouts WHERE owner_id = ? ORDER BY scouted_at DESC LIMIT 80`).bind(ownerId),
  ]);
  return {
    topics: topics.results as unknown as Array<{ id: string; label: string }>,
    authors: [...new Set([
      ...(authors.results as unknown as Array<{ author_username: string }>).map((row) => row.author_username),
      ...(follows.results as unknown as Array<{ username: string }>).map((row) => row.username),
    ])],
    knownPostIds: [
      ...(bookmarks.results as unknown as Array<{ post_id: string }>).map((row) => row.post_id),
      ...(scouts.results as unknown as Array<{ post_id: string }>).map((row) => row.post_id),
    ],
  };
}

export async function storeScouts(ownerId: string, finds: StoredScout[]) {
  await ensureSchema();
  const alreadySaved = await existingBookmarkIds(ownerId, finds.map((find) => find.postId));
  const uniqueFinds = finds.filter((find) => !alreadySaved.has(find.postId));
  const d1 = getD1();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const find of uniqueFinds) {
    const topicIdValue = find.topicId || topicId(find.topicLabel);
    if (topicIdValue) {
      statements.push(
        d1.prepare(`INSERT INTO topics (owner_id, id, label, source, created_at)
          VALUES (?, ?, ?, 'scout', ?)
          ON CONFLICT(owner_id, id) DO UPDATE SET label = excluded.label`)
          .bind(ownerId, topicIdValue, find.topicLabel, now),
      );
    }
    statements.push(
      d1.prepare(`INSERT INTO scouts (
        owner_id, post_id, author_username, author_name, text, url,
        topic_id, topic_label, reason, confidence, scouted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, post_id) DO UPDATE SET
        author_username = excluded.author_username,
        author_name = excluded.author_name,
        text = excluded.text,
        url = excluded.url,
        topic_id = excluded.topic_id,
        topic_label = excluded.topic_label,
        reason = excluded.reason,
        confidence = excluded.confidence,
        scouted_at = excluded.scouted_at`)
        .bind(
          ownerId,
          find.postId,
          find.authorUsername,
          find.authorName,
          find.text,
          find.url,
          topicIdValue || null,
          find.topicLabel,
          find.reason,
          find.confidence,
          now,
        ),
    );
  }
  for (let index = 0; index < statements.length; index += 80) {
    await d1.batch(statements.slice(index, index + 80));
  }
  return uniqueFinds.length;
}

export async function loadLinkHosts(ownerId: string, limit = 32) {
  await ensureSchema();
  const rows = await getD1().prepare(
    'SELECT entities_json, text FROM bookmarks WHERE owner_id = ? ORDER BY synced_at DESC LIMIT 400',
  ).bind(ownerId).all<{ entities_json: string; text: string }>();
  const hosts = new Set<string>();
  for (const row of rows.results) {
    let entities: unknown = {};
    try {
      entities = JSON.parse(row.entities_json) as unknown;
    } catch {
      entities = {};
    }
    for (const url of urlsFromBookmark(entities, row.text)) {
      const host = hostFromUrl(url);
      if (host) hosts.add(host);
      if (hosts.size >= limit) return [...hosts];
    }
  }
  return [...hosts];
}

export async function storeFeed(ownerId: string, probe: FeedProbe) {
  await ensureSchema();
  await getD1().prepare(`INSERT INTO feeds (owner_id, host, page_url, feeds_json, status, error, probed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, host) DO UPDATE SET
      page_url = excluded.page_url,
      feeds_json = excluded.feeds_json,
      status = excluded.status,
      error = excluded.error,
      probed_at = excluded.probed_at`)
    .bind(ownerId, probe.host, probe.pageUrl, JSON.stringify(probe.feeds), probe.status, probe.error ?? null, probe.probedAt)
    .run();
}

export async function loadFeeds(ownerId: string): Promise<FeedProbe[]> {
  await ensureSchema();
  const rows = await getD1().prepare(
    'SELECT host, page_url, feeds_json, status, error, probed_at FROM feeds WHERE owner_id = ? ORDER BY probed_at DESC',
  ).bind(ownerId).all<{
    host: string;
    page_url: string;
    feeds_json: string;
    status: FeedProbe['status'];
    error: string | null;
    probed_at: number;
  }>();
  return rows.results.map((row) => {
    let feeds: FeedProbe['feeds'] = [];
    try {
      feeds = JSON.parse(row.feeds_json) as FeedProbe['feeds'];
    } catch {
      feeds = [];
    }
    return {
      host: row.host,
      pageUrl: row.page_url,
      feeds: Array.isArray(feeds) ? feeds : [],
      status: row.status,
      error: row.error ?? undefined,
      probedAt: row.probed_at,
    };
  });
}

export async function deleteOwnerData(ownerId: string) {
  return withOwnerWork(ownerId, async () => {
    await ensureSchema();
    const d1 = getD1();
    await d1.batch([
      d1.prepare('DELETE FROM bookmark_observations WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM bookmark_sync_state WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM bookmark_topics WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM topics WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM bookmarks WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM scouts WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM follows WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM feeds WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM shares WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM trajectories WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM bridge_requests WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM research_cards WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM research_requests WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM x_sessions WHERE owner_id = ?').bind(ownerId),
      d1.prepare('DELETE FROM accounts WHERE id = ?').bind(ownerId),
    ]);
  });
}

export async function saveShare(id: string, ownerId: string, capsule: GraphCapsule) {
  await ensureSchema();
  await getD1().prepare(
    'INSERT INTO shares (id, owner_id, name, capsule_json, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, ownerId, capsule.name, JSON.stringify(capsule), Date.now()).run();
}

export async function countSharesSince(ownerId: string, since: number) {
  await ensureSchema();
  const row = await getD1().prepare(
    'SELECT COUNT(*) AS n FROM shares WHERE owner_id = ? AND created_at >= ?',
  ).bind(ownerId, since).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function loadRecentFeedHosts(ownerId: string, since: number) {
  await ensureSchema();
  const rows = await getD1().prepare(
    'SELECT host FROM feeds WHERE owner_id = ? AND probed_at >= ?',
  ).bind(ownerId, since).all<{ host: string }>();
  return new Set(rows.results.map((row) => row.host));
}

export async function loadShare(id: string): Promise<{ id: string; ownerId: string; capsule: GraphCapsule; createdAt: number } | null> {
  await ensureSchema();
  const row = await getD1().prepare(
    'SELECT id, owner_id, name, capsule_json, created_at FROM shares WHERE id = ?',
  ).bind(id).first<{ id: string; owner_id: string; name: string; capsule_json: string; created_at: number }>();
  if (!row) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.capsule_json) as unknown;
  } catch {
    return null;
  }
  const capsule = parseCapsule(parsed);
  if (!capsule) return null;
  return { id: row.id, ownerId: row.owner_id, capsule, createdAt: row.created_at };
}
