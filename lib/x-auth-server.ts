import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { refreshXSession } from './x-api';
import { openXSession, sealXSession, X_SESSION_COOKIE, type XSession } from './x-session';

export const X_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24 * 180,
};

export function withRenewedSession(response: NextResponse, renewedCookie?: string) {
  if (renewedCookie) {
    response.cookies.set(X_SESSION_COOKIE, renewedCookie, X_SESSION_COOKIE_OPTIONS);
  }
  return response;
}

export async function getActiveXSession(request: NextRequest): Promise<{
  session: XSession;
  renewedCookie?: string;
} | null> {
  const encrypted = request.cookies.get(X_SESSION_COOKIE)?.value;
  if (!encrypted) return null;
  const session = await openXSession(encrypted);
  if (!session) return null;

  if (session.expiresAt > Date.now() + 60_000) return { session };
  try {
    const refreshed = await refreshXSession(session);
    return { session: refreshed, renewedCookie: await sealXSession(refreshed) };
  } catch {
    return null;
  }
}
