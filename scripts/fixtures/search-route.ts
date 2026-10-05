// Installed only in the disposable API preview by scripts/test-api.mjs.
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getD1 } from '@/db';
import { ensureSchema } from '@/db/storage';
import { getRuntimeValue } from '@/lib/runtime-env';
import { sealXSession } from '@/lib/x-session';

export async function POST(request: NextRequest) {
  if (request.nextUrl.hostname !== '127.0.0.1' || request.nextUrl.port !== '3012'
    || getRuntimeValue('X_CLIENT_ID') !== 'stimgraph-inert-test'
    || getRuntimeValue('X_CLIENT_SECRET') !== 'stimgraph-inert-test-secret'
    || getRuntimeValue('XAI_API_KEY')) return new NextResponse(null, { status: 404 });
  await ensureSchema();
  const db = getD1();
  const rows = Array.from({ length: 65 }, (_, index) => ({
    id: `loose-${String(index).padStart(3, '0')}`, text: 'Learning to build a machine', date: '2026-01-01', imported: 1000,
  }));
  rows.push({ id: 'best', text: 'A practical guide to machine learning', date: '2020-01-01', imported: 1 });
  rows.push({ id: 'literal', text: '100% useful_method', date: '2025-01-01', imported: 2 });
  await db.batch(rows.map((row) => db.prepare(`INSERT OR IGNORE INTO bookmarks
    (owner_id, post_id, author_id, author_username, author_name, text, created_at, synced_at)
    VALUES ('search-test-owner', ?, 'author', 'alice', 'Alice', ?, ?, ?)`).bind(row.id, row.text, row.date, row.imported)));
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO bookmarks (owner_id, post_id, author_id, author_username, author_name, text, synced_at)
      VALUES ('search-test-other', 'private', 'author', 'alice', 'Alice', 'Machine learning private', 99999)`),
    db.prepare(`INSERT OR IGNORE INTO topics VALUES ('search-test-owner', 'ml', 'Machine learning', 'test', 1)`),
    db.prepare(`INSERT OR IGNORE INTO bookmark_topics VALUES ('search-test-owner', 'best', 'ml', 100, 'Synthetic fixture', 'test')`),
    db.prepare(`INSERT OR IGNORE INTO topics VALUES ('search-test-other', 'secret', 'Machine learning', 'test', 1)`),
    db.prepare(`INSERT OR IGNORE INTO bookmark_topics VALUES ('search-test-other', 'literal', 'secret', 100, 'Synthetic fixture', 'test')`),
  ]);
  const cookie = await sealXSession({ accessToken: 'inert-fixture-no-network', expiresAt: Date.now() + 3600_000,
    profile: { id: 'search-test-owner', username: 'search_test', name: 'Synthetic search test' } });
  const response = NextResponse.json({ count: rows.length });
  response.cookies.set('stim_x_session', cookie, { httpOnly: true, sameSite: 'lax', path: '/' });
  return response;
}
