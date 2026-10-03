import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadBookmarkLibrary } from '@/db/bookmark-library';
import { parseLibraryQuery } from '@/lib/bookmark-library';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ error: 'Connect X to open your bookmark library.' }, { status: 401, headers });
  const data = await loadBookmarkLibrary(active.session.profile.id, parseLibraryQuery(request.nextUrl.searchParams));
  return withRenewedSession(NextResponse.json(data, { headers }), request, active.renewedCookie);
}
