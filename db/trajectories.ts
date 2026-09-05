import { getD1 } from './index';
import { ensureSchema } from './storage';
import { parseTrajectoryDraft, type ConceptTrajectory, type TrajectoryDraft } from '@/lib/trajectory-model';

export async function loadTrajectories(ownerId: string): Promise<ConceptTrajectory[]> {
  await ensureSchema();
  const rows = await getD1().prepare(
    'SELECT id, name, question, steps_json, created_at FROM trajectories WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 100',
  ).bind(ownerId).all<{ id: string; name: string; question: string; steps_json: string; created_at: number }>();
  return rows.results.flatMap((row) => {
    try {
      const draft = parseTrajectoryDraft({ name: row.name, question: row.question, steps: JSON.parse(row.steps_json) });
      return draft ? [{ ...draft, id: row.id, createdAt: row.created_at }] : [];
    } catch { return []; }
  });
}

export async function saveTrajectory(ownerId: string, draft: TrajectoryDraft): Promise<ConceptTrajectory | null> {
  await ensureSchema();
  const trajectory = { ...draft, id: crypto.randomUUID(), createdAt: Date.now() };
  const result = await getD1().prepare(
    `INSERT INTO trajectories (owner_id, id, name, question, steps_json, created_at)
     SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM trajectories WHERE owner_id = ?) < 100`,
  ).bind(ownerId, trajectory.id, draft.name, draft.question, JSON.stringify(draft.steps), trajectory.createdAt, ownerId).run();
  return result.meta.changes ? trajectory : null;
}

export async function deleteTrajectory(ownerId: string, id: string) {
  await ensureSchema();
  const result = await getD1().prepare('DELETE FROM trajectories WHERE owner_id = ? AND id = ?').bind(ownerId, id).run();
  return Boolean(result.meta.changes);
}
