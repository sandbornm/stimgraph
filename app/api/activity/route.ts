import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readActivity } from '@/db/activity';
import { activityQuery } from '@/lib/background-policy';
import { resolveOwnerId } from '@/lib/owner-request';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Tailscale-User-Login' };

export async function GET(request: NextRequest) {
  const ownerId = await resolveOwnerId(request);
  if (!ownerId) return NextResponse.json({ error: 'An authenticated owner is required.' }, { status: 401, headers });
  const query = activityQuery(request.nextUrl.searchParams);
  if (!query) return NextResponse.json({ error: 'Use a nonnegative integer after and a limit from 1 to 500.' }, { status: 400, headers });
  return NextResponse.json(await readActivity(ownerId, query.after, query.limit), { headers });
}
