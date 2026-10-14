import { getD1 } from './index';
import { ensureSchema } from './storage';
import {
  DEFAULT_JEV_TOPICS, JEV_CONCURRENCY, acceptedLabel, fingerprint, labelPost, mapLimit, normalizeTopics, topicsKey,
  type JevTopics,
} from '@/lib/jev';

export async function loadJevTopics(ownerId: string): Promise<JevTopics> {
  await ensureSchema();
  const row = await getD1().prepare('SELECT topics_json FROM jev_topic_config WHERE owner_id = ?')
    .bind(ownerId).first<{ topics_json: string }>();
  if (!row) return { ...DEFAULT_JEV_TOPICS };
  try { return normalizeTopics(JSON.parse(row.topics_json)); } catch { return { ...DEFAULT_JEV_TOPICS }; }
}

export async function saveJevTopics(ownerId: string, input: unknown) {
  const topics = normalizeTopics(input);
  await ensureSchema();
  await getD1().prepare(`INSERT INTO jev_topic_config(owner_id, topics_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET topics_json = excluded.topics_json, updated_at = excluded.updated_at`)
    .bind(ownerId, JSON.stringify(topics), Date.now()).run();
  return topics;
}

export type JevRunResult = { considered: number; labeled: number; accepted: number; failed: number; skipped: number };

/**
 * Label bookmarks that have no current Jev label. A post is relabeled only when its text
 * or the topic list changed. Accepted labels become `jev-<label>` topics (source 'jev');
 * low-confidence or "other" answers are cached but add no topic, so keyword chips apply.
 */
export async function labelPendingBookmarks(ownerId: string, apiKey: string, { limit = 1000, fetchImpl }: {
  limit?: number; fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
} = {}): Promise<JevRunResult> {
  await ensureSchema();
  const d1 = getD1();
  const topics = await loadJevTopics(ownerId);
  const topicsHash = await fingerprint(topicsKey(topics));
  const rows = (await d1.prepare(`SELECT b.post_id, b.text, b.author_username, l.text_hash, l.topics_hash
    FROM bookmarks b LEFT JOIN jev_labels l ON l.owner_id = b.owner_id AND l.post_id = b.post_id
    WHERE b.owner_id = ? ORDER BY b.synced_at DESC`).bind(ownerId)
    .all<{ post_id: string; text: string; author_username: string; text_hash: string | null; topics_hash: string | null }>()).results;
  const pending: Array<{ postId: string; text: string; author: string; textHash: string }> = [];
  let skipped = 0;
  for (const row of rows) {
    const textHash = await fingerprint(row.text);
    if (row.text_hash === textHash && row.topics_hash === topicsHash) { skipped += 1; continue; }
    if (pending.length < limit) pending.push({ postId: row.post_id, text: row.text, author: row.author_username, textHash });
  }
  const results = await mapLimit(pending, JEV_CONCURRENCY, (item) =>
    labelPost({ apiKey, text: item.text, author: item.author, topics, fetchImpl }));
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  let accepted = 0;
  for (const { item, value } of results) {
    if (!value) continue;
    statements.push(
      d1.prepare(`INSERT INTO jev_labels(owner_id, post_id, text_hash, topics_hash, label, confidence, model, labeled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, post_id) DO UPDATE SET text_hash = excluded.text_hash,
        topics_hash = excluded.topics_hash, label = excluded.label, confidence = excluded.confidence,
        model = excluded.model, labeled_at = excluded.labeled_at`)
        .bind(ownerId, item.postId, item.textHash, topicsHash, value.label, value.confidence, value.model, now),
      d1.prepare(`DELETE FROM bookmark_topics WHERE owner_id = ? AND post_id = ? AND source = 'jev'`).bind(ownerId, item.postId),
    );
    const label = acceptedLabel(value);
    if (!label) continue;
    accepted += 1;
    statements.push(
      d1.prepare(`INSERT INTO topics (owner_id, id, label, source, created_at) VALUES (?, ?, ?, 'jev', ?)
        ON CONFLICT(owner_id, id) DO NOTHING`).bind(ownerId, `jev-${label}`, label, now),
      d1.prepare(`INSERT INTO bookmark_topics (owner_id, post_id, topic_id, confidence, evidence, source)
        VALUES (?, ?, ?, ?, ?, 'jev') ON CONFLICT(owner_id, post_id, topic_id) DO UPDATE SET
        confidence = excluded.confidence, evidence = excluded.evidence`)
        .bind(ownerId, item.postId, `jev-${label}`, Math.round(value.confidence * 100), `Jev ${value.model}`),
    );
  }
  for (let index = 0; index < statements.length; index += 80) await d1.batch(statements.slice(index, index + 80));
  const failed = results.filter((r) => r.error).length;
  return { considered: pending.length, labeled: results.length - failed, accepted, failed, skipped };
}
