import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getD1 } from '@/db/index';
import { readActivity } from '@/db/activity';
import { ensureSchema, loadXSessionRecord } from '@/db/storage';
import { X_SESSION_COOKIE } from '@/lib/x-session';
import { getRuntimeValue } from '@/lib/runtime-env';
import { activityQuery, trustedTailnetLogin } from '@/lib/background-policy';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Tailscale-User-Login' };

export async function GET(request: NextRequest) {
  await ensureSchema();
  let ownerId: string | undefined;
  const cookie = request.cookies.get(X_SESSION_COOKIE)?.value;
  if (cookie && !cookie.includes('.')) ownerId = (await loadXSessionRecord(cookie))?.ownerId;
  if (!ownerId && getRuntimeValue('STIMGRAPH_TAILNET') === 'true'
    && trustedTailnetLogin(request.headers, getRuntimeValue('STIMGRAPH_TAILNET_LOGIN'))) {
    // The personal service is deliberately single-owner. Ambiguity fails closed.
    const owners = await getD1().prepare(`SELECT id FROM accounts UNION SELECT owner_id AS id
      FROM x_sessions WHERE expires_at > ? LIMIT 2`).bind(Date.now()).all<{ id: string }>();
    if (owners.results.length === 1) ownerId = owners.results[0].id;
  }
  if (!ownerId) return NextResponse.json({ error: 'An authenticated owner is required.' }, { status: 401, headers });
  const query = activityQuery(request.nextUrl.searchParams);
  if (!query) return NextResponse.json({ error: 'Use a nonnegative integer after and a limit from 1 to 500.' }, { status: 400, headers });
  return NextResponse.json(await readActivity(ownerId, query.after, query.limit), { headers });
}
