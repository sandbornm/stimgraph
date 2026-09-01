import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { storeBookmarks } from '@/db/storage';
import { getActiveXSession } from '@/lib/x-auth-server';
import { fetchXBookmarks } from '@/lib/x-bookmarks';
import { X_SESSION_COOKIE } from '@/lib/x-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const active = await getActiveXSession(request);
  if (!active) return NextResponse.json({ error: 'Connect X before syncing.' }, { status: 401 });

  let requestedLimit = 600;
  try {
    const body = (await request.json()) as { limit?: number };
    if (typeof body.limit === 'number') requestedLimit = body.limit;
  } catch {
    // The default limit is intentionally conservative.
  }
  const limit = Math.max(1, Math.min(1000, Math.floor(requestedLimit)));

  try {
    const result = await fetchXBookmarks({
      accessToken: active.session.accessToken,
      userId: active.session.profile.id,
      limit,
    });
    await storeBookmarks({ owner: active.session.profile, bookmarks: result.bookmarks });
    const response = NextResponse.json({
      imported: result.bookmarks.length,
      hasMore: result.hasMore,
      limit,
    });
    if (active.renewedCookie) {
      response.cookies.set(X_SESSION_COOKIE, active.renewedCookie, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 180,
      });
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bookmark sync failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
