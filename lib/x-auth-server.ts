import type { NextRequest } from 'next/server';
import { refreshXSession } from './x-api';
import { openXSession, sealXSession, X_SESSION_COOKIE, type XSession } from './x-session';

export async function getActiveXSession(request: NextRequest): Promise<{
  session: XSession;
  renewedCookie?: string;
} | null> {
  const encrypted = request.cookies.get(X_SESSION_COOKIE)?.value;
  if (!encrypted) return null;
  const session = await openXSession(encrypted);
  if (!session) return null;

  if (session.expiresAt > Date.now() + 60_000) return { session };
  const refreshed = await refreshXSession(session);
  return { session: refreshed, renewedCookie: await sealXSession(refreshed) };
}
