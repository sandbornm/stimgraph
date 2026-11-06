import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getD1 } from '@/db/index';
import { labelPendingBookmarks, loadJevTopics, saveJevTopics } from '@/db/jev';
import { getRuntimeValue } from '@/lib/runtime-env';
import { resolveOwnerId } from '@/lib/owner-request';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Tailscale-User-Login' };
const denied = () => NextResponse.json({ error: 'An authenticated owner is required.' }, { status: 401, headers });

export async function GET(request: NextRequest) {
  const ownerId = await resolveOwnerId(request);
  if (!ownerId) return denied();
  const counts = await getD1().prepare(`SELECT COUNT(*) AS labeled, SUM(CASE WHEN label != 'other' AND confidence >= 0.5 THEN 1 ELSE 0 END) AS accepted
    FROM jev_labels WHERE owner_id = ?`).bind(ownerId).first<{ labeled: number; accepted: number | null }>();
  return NextResponse.json({ enabled: Boolean(getRuntimeValue('TYPESAFE_API_KEY')), topics: await loadJevTopics(ownerId),
    labeled: counts?.labeled ?? 0, accepted: counts?.accepted ?? 0 }, { headers });
}

export async function PUT(request: NextRequest) {
  const ownerId = await resolveOwnerId(request);
  if (!ownerId) return denied();
  try {
    const body = await request.json() as { topics?: unknown };
    return NextResponse.json({ topics: await saveJevTopics(ownerId, body.topics) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid topics.' }, { status: 400, headers });
  }
}

export async function POST(request: NextRequest) {
  const ownerId = await resolveOwnerId(request);
  if (!ownerId) return denied();
  const apiKey = getRuntimeValue('TYPESAFE_API_KEY');
  if (!apiKey) return NextResponse.json({ error: 'Jev labeling is off: TYPESAFE_API_KEY is not configured.' }, { status: 409, headers });
  const body = await request.json().catch(() => ({})) as { limit?: number };
  const limit = Number.isSafeInteger(body.limit) && body.limit! > 0 ? Math.min(body.limit!, 1000) : 1000;
  return NextResponse.json(await labelPendingBookmarks(ownerId, apiKey, { limit }), { headers });
}
