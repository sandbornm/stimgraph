import { getD1 } from './index';
import { ensureSchema } from './storage';
import { normalizeQuote, parseResearchDraft, researchExcerpt, type ResearchCard, type ResearchDraft, type ResearchSource } from '@/lib/research-model';

export async function loadResearchSources(ownerId: string, ids: string[]): Promise<ResearchSource[]> {
  await ensureSchema();
  const rows = await getD1().prepare(`SELECT post_id, text FROM bookmarks
    WHERE owner_id = ? AND post_id IN (SELECT value FROM json_each(?))`)
    .bind(ownerId, JSON.stringify(ids.map((id) => id.slice(9)))).all<{ post_id: string; text: string }>();
  const sources = new Map(rows.results.map((row) => [`bookmark:${row.post_id}`, {
    id: `bookmark:${row.post_id}`, label: researchExcerpt(row.text).replace(/\s+/g, ' ').slice(0, 120) || 'Saved post', excerpt: researchExcerpt(row.text),
  }]));
  return ids.flatMap((id) => sources.has(id) ? [sources.get(id)!] : []);
}

export async function loadResearchCards(ownerId: string): Promise<ResearchCard[]> {
  await ensureSchema();
  const rows = await getD1().prepare('SELECT id, card_json, created_at FROM research_cards WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT 100')
    .bind(ownerId).all<{ id: string; card_json: string; created_at: number }>();
  return rows.results.flatMap((row) => {
    try { const card = parseResearchDraft(JSON.parse(row.card_json)); return card ? [{ ...card, id: row.id, createdAt: row.created_at }] : []; }
    catch { return []; }
  });
}

export async function saveResearchCard(ownerId: string, draft: ResearchDraft): Promise<ResearchCard | null> {
  const sources = await loadResearchSources(ownerId, draft.sources.map((source) => source.id));
  const verified = draft.sources.map((source) => {
    const current = sources.find((item) => item.id === source.id);
    if (!current || (source.quote && !normalizeQuote(current.excerpt).includes(normalizeQuote(source.quote)))) {
      throw new Error('A source is missing or its quotation has changed. Start a new card from current bookmarks.');
    }
    return { ...source, label: current.label };
  });
  const card = { ...draft, sources: verified, id: crypto.randomUUID(), createdAt: Date.now() };
  const result = await getD1().prepare(`INSERT INTO research_cards (owner_id, id, card_json, created_at)
    SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM research_cards WHERE owner_id = ?) < 100`)
    .bind(ownerId, card.id, JSON.stringify({ ...draft, sources: verified }), card.createdAt, ownerId).run();
  return result.meta.changes ? card : null;
}

export async function deleteResearchCard(ownerId: string, id: string) {
  await ensureSchema();
  const result = await getD1().prepare('DELETE FROM research_cards WHERE owner_id = ? AND id = ?').bind(ownerId, id).run();
  return Boolean(result.meta.changes);
}

export async function reserveResearchRequest(ownerId: string, kind: 'generate' | 'nearby') {
  await ensureSchema();
  const now = Date.now();
  const result = await getD1().batch([
    getD1().prepare('DELETE FROM research_requests WHERE owner_id = ? AND created_at < ?').bind(ownerId, now - 86_400_000),
    getD1().prepare(`INSERT INTO research_requests (id, owner_id, kind, created_at)
      SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM research_requests WHERE owner_id = ? AND kind = ? AND created_at >= ?) < ?
      AND NOT EXISTS (SELECT 1 FROM research_requests WHERE owner_id = ? AND kind = ? AND created_at >= ?)`)
      .bind(crypto.randomUUID(), ownerId, kind, now, ownerId, kind, now - 86_400_000, kind === 'generate' ? 12 : 30, ownerId, kind, now - (kind === 'generate' ? 20_000 : 2_000)),
  ]);
  return Boolean(result[1].meta.changes);
}
