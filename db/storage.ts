import { getD1 } from './index';
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

let initialized = false;

export async function ensureSchema() {
  if (initialized) return;
  const d1 = getD1();
  await d1.batch([
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
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_bookmarks_owner_author ON bookmarks(owner_id, author_id)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_bookmarks_owner_created ON bookmarks(owner_id, created_at)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_topics_owner_label ON topics(owner_id, label)'),
    d1.prepare('CREATE INDEX IF NOT EXISTS idx_bookmark_topics_owner_topic ON bookmark_topics(owner_id, topic_id)'),
  ]);
  initialized = true;
}

function topicId(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
}

export async function storeBookmarks({
  owner,
  bookmarks,
}: {
  owner: XProfile;
  bookmarks: StoredBookmark[];
}) {
  await ensureSchema();
  const d1 = getD1();
  const now = Date.now();
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
  }

  for (let index = 0; index < statements.length; index += 80) {
    await d1.batch(statements.slice(index, index + 80));
  }
  await d1.prepare('PRAGMA optimize').run();
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

export async function loadGraph(ownerId: string) {
  await ensureSchema();
  const d1 = getD1();
  const [authors, topics, connections, bookmarkRows, bookmarkTopics, topicAffinities, authorAffinities, totals] = await d1.batch([
    d1.prepare(`SELECT author_id, author_username, author_name, author_profile_image_url,
      COUNT(*) AS bookmark_count
      FROM bookmarks WHERE owner_id = ?
      GROUP BY author_id, author_username, author_name, author_profile_image_url
      ORDER BY bookmark_count DESC LIMIT 90`).bind(ownerId),
    d1.prepare(`SELECT t.id, t.label, t.source, COUNT(bt.post_id) AS bookmark_count
      FROM topics t
      JOIN bookmark_topics bt ON bt.owner_id = t.owner_id AND bt.topic_id = t.id
      WHERE t.owner_id = ?
      GROUP BY t.id, t.label, t.source
      ORDER BY bookmark_count DESC LIMIT 50`).bind(ownerId),
    d1.prepare(`SELECT b.author_id, bt.topic_id, COUNT(*) AS connection_count
      FROM bookmarks b
      JOIN bookmark_topics bt ON bt.owner_id = b.owner_id AND bt.post_id = b.post_id
      WHERE b.owner_id = ?
      GROUP BY b.author_id, bt.topic_id
      ORDER BY connection_count DESC LIMIT 600`).bind(ownerId),
    d1.prepare(`SELECT post_id, author_id, author_username, author_name, text, created_at
      FROM bookmarks
      WHERE owner_id = ?
      ORDER BY created_at DESC, synced_at DESC
      LIMIT 160`).bind(ownerId),
    d1.prepare(`SELECT bt.post_id, bt.topic_id, bt.confidence
      FROM bookmark_topics bt
      JOIN bookmarks b ON b.owner_id = bt.owner_id AND b.post_id = bt.post_id
      WHERE bt.owner_id = ?
      ORDER BY b.created_at DESC, bt.confidence DESC
      LIMIT 800`).bind(ownerId),
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
      LIMIT 180`).bind(ownerId),
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
      LIMIT 160`).bind(ownerId),
    d1.prepare('SELECT COUNT(*) AS bookmark_count, COUNT(DISTINCT author_id) AS author_count FROM bookmarks WHERE owner_id = ?').bind(ownerId),
  ]);

  return {
    authors: authors.results as unknown as AuthorRow[],
    topics: topics.results as unknown as TopicRow[],
    connections: connections.results as unknown as ConnectionRow[],
    bookmarks: bookmarkRows.results as unknown as BookmarkRow[],
    bookmarkTopics: bookmarkTopics.results as unknown as BookmarkTopicRow[],
    topicAffinities: topicAffinities.results as unknown as TopicAffinityRow[],
    authorAffinities: authorAffinities.results as unknown as AuthorAffinityRow[],
    totals: (totals.results[0] ?? { bookmark_count: 0, author_count: 0 }) as {
      bookmark_count: number;
      author_count: number;
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

export async function deleteOwnerData(ownerId: string) {
  await ensureSchema();
  const d1 = getD1();
  await d1.batch([
    d1.prepare('DELETE FROM bookmark_topics WHERE owner_id = ?').bind(ownerId),
    d1.prepare('DELETE FROM topics WHERE owner_id = ?').bind(ownerId),
    d1.prepare('DELETE FROM bookmarks WHERE owner_id = ?').bind(ownerId),
    d1.prepare('DELETE FROM accounts WHERE id = ?').bind(ownerId),
  ]);
}
