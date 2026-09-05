// Copy into app/api/test-research/route.ts only in the isolated test preview.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getD1 } from '@/db';
import { ensureSchema } from '@/db/storage';
import { reserveResearchRequest } from '@/db/research';
import { getRuntimeValue } from '@/lib/runtime-env';
import { getActiveXSession } from '@/lib/x-auth-server';

export async function POST(request: NextRequest) {
  if (request.nextUrl.hostname !== '127.0.0.1' || request.nextUrl.port !== '3012'
    || getRuntimeValue('X_CLIENT_ID') !== 'stimgraph-research-test'
    || getRuntimeValue('X_CLIENT_SECRET') !== 'stimgraph-inert-test-secret'
    || getRuntimeValue('XAI_API_KEY')) return new NextResponse(null, { status: 404 });
  const active = await getActiveXSession(request);
  const owner = active?.session.profile.id;
  if (!owner?.startsWith('research-test-')) return new NextResponse(null, { status: 401 });
  await ensureSchema();
  const db = getD1();
  const { action } = await request.json() as { action: string };
  if (action === 'seed') {
    await db.batch(['a', 'b'].map((id) => db.prepare(`INSERT OR REPLACE INTO bookmarks
      (owner_id, post_id, author_id, author_username, author_name, text, synced_at) VALUES (?, ?, 'test', 'test', 'Test author', ?, ?)`)
      .bind(owner, `${owner}-${id}`, id === 'a' ? `https://example.invalid/${'a'.repeat(2200)} A small proof checks each transformation.` : 'Memory limits make validation costly.', Date.now())));
    return NextResponse.json({ ids: [`bookmark:${owner}-a`, `bookmark:${owner}-b`] });
  }
  if (action === 'quotas') {
    const result: Record<string, { burst: number; daily: boolean; otherKind?: boolean }> = {};
    for (const kind of ['generate', 'nearby'] as const) {
      await db.prepare('DELETE FROM research_requests WHERE owner_id = ?').bind(owner).run();
      const burst = (await Promise.all(Array.from({ length: 3 }, () => reserveResearchRequest(owner, kind)))).filter(Boolean).length;
      const otherKind = await reserveResearchRequest(owner, kind === 'generate' ? 'nearby' : 'generate');
      await db.prepare('DELETE FROM research_requests WHERE owner_id = ?').bind(owner).run();
      await db.batch(Array.from({ length: kind === 'generate' ? 12 : 30 }, () => db.prepare('INSERT INTO research_requests (id, owner_id, kind, created_at) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), owner, kind, Date.now() - 60_000)));
      result[kind] = { burst, daily: await reserveResearchRequest(owner, kind), otherKind };
    }
    return NextResponse.json(result);
  }
  if (action === 'fill-cards') {
    const first = await db.prepare('SELECT card_json FROM research_cards WHERE owner_id = ? LIMIT 1').bind(owner).first<{ card_json: string }>();
    if (!first) return new NextResponse(null, { status: 400 });
    await db.prepare('DELETE FROM research_cards WHERE owner_id = ?').bind(owner).run();
    await db.batch(Array.from({ length: 99 }, () => db.prepare('INSERT INTO research_cards (owner_id, id, card_json, created_at) VALUES (?, ?, ?, ?)')
      .bind(owner, crypto.randomUUID(), first.card_json, Date.now())));
    return NextResponse.json({ filled: true });
  }
  if (action === 'counts') {
    const cards = await db.prepare('SELECT COUNT(*) AS n FROM research_cards WHERE owner_id = ?').bind(owner).first<{ n: number }>();
    const requests = await db.prepare('SELECT COUNT(*) AS n FROM research_requests WHERE owner_id = ?').bind(owner).first<{ n: number }>();
    return NextResponse.json({ cards: cards?.n, requests: requests?.n });
  }
  return new NextResponse(null, { status: 400 });
}
