import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadBookmarkLibrary } from '@/db/bookmark-library';
import { parseLibraryQuery } from '@/lib/bookmark-library';
import { getActiveXSession, withRenewedSession } from '@/lib/x-auth-server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const startedAt = performance.now();
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ error: 'Connect X to open your bookmark library.' }, { status: 401, headers });
  const authenticatedAt = performance.now();
  const data = await loadBookmarkLibrary(active.session.profile.id, parseLibraryQuery(request.nextUrl.searchParams));
  return withRenewedSession(NextResponse.json(data, { headers: {
    ...headers,
    'Server-Timing': `auth;dur=${(authenticatedAt - startedAt).toFixed(1)}, library;dur=${(performance.now() - authenticatedAt).toFixed(1)}`,
  } }), request, active.renewedCookie);
}
