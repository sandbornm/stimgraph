import { getD1 } from './index';
import { ensureSchema } from './storage';
import { buildExploreIndex, type ExploreNode } from '@/lib/explore-model';

export async function loadBridgeIndex(ownerId: string, visibleIds: string[]) {
  await ensureSchema();
  const topics = JSON.stringify(visibleIds.filter((id) => id.startsWith('topic:')).map((id) => id.slice(6)));
  const posts = JSON.stringify(visibleIds.filter((id) => id.startsWith('bookmark:')).map((id) => id.slice(9)));
  const rows = await getD1().batch([
    getD1().prepare(`SELECT id, label FROM topics WHERE owner_id = ? AND id IN (SELECT value FROM json_each(?))`).bind(ownerId, topics),
    getD1().prepare(`SELECT post_id, substr(text, 1, 600) AS text FROM bookmarks WHERE owner_id = ? AND post_id IN (SELECT value FROM json_each(?))`).bind(ownerId, posts),
    getD1().prepare(`SELECT post_id, topic_id FROM bookmark_topics WHERE owner_id = ?
      AND post_id IN (SELECT value FROM json_each(?)) AND topic_id IN (SELECT value FROM json_each(?))`).bind(ownerId, posts, topics),
  ]);
  const nodes: ExploreNode[] = [
    ...(rows[0].results as unknown as Array<{ id: string; label: string }>).map((row) => ({ id: `topic:${row.id}`, label: row.label, kind: 'topic' as const, note: '', evidence: '', size: 1 })),
    ...(rows[1].results as unknown as Array<{ post_id: string; text: string }>).map((row) => ({ id: `bookmark:${row.post_id}`, label: 'Saved post', kind: 'source' as const, note: row.text, evidence: '', size: 1 })),
  ];
  const edges = (rows[2].results as unknown as Array<{ post_id: string; topic_id: string }>).map((row) => ({ from: `bookmark:${row.post_id}`, to: `topic:${row.topic_id}`, kind: 'evidence' as const, weight: 1 }));
  return buildExploreIndex(nodes, edges);
}

export async function reserveBridgeRequest(ownerId: string) {
  await ensureSchema();
  const now = Date.now();
  const result = await getD1().batch([
    getD1().prepare('DELETE FROM bridge_requests WHERE owner_id = ? AND created_at < ?').bind(ownerId, now - 86_400_000),
    getD1().prepare(`INSERT INTO bridge_requests (id, owner_id, created_at)
      SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM bridge_requests WHERE owner_id = ? AND created_at >= ?) < 12
      AND NOT EXISTS (SELECT 1 FROM bridge_requests WHERE owner_id = ? AND created_at >= ?)`)
      .bind(crypto.randomUUID(), ownerId, now, ownerId, now - 86_400_000, ownerId, now - 20_000),
  ]);
  return Boolean(result[1].meta.changes);
}
