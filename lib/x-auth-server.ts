import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  deleteXSessionRecord,
  loadXSessionRecord,
  replaceXSessionRecord,
  saveXSessionRecord,
  X_SESSION_TTL_MS,
} from '@/db/storage';
import { refreshXSession } from './x-api';
import { XRequestError } from './x-errors';
import { requestOrigin } from './request-origin';
import { openXSession, randomBase64Url, sealXSession, X_SESSION_COOKIE, type XSession } from './x-session';

const SESSION_MAX_AGE_SECONDS = Math.floor(X_SESSION_TTL_MS / 1000);

export function sessionCookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: requestOrigin(request).startsWith('https:'),
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function withRenewedSession(response: NextResponse, request: NextRequest, renewedCookie?: string) {
  if (renewedCookie) {
    response.cookies.set(X_SESSION_COOKIE, renewedCookie, sessionCookieOptions(request));
  }
  return response;
}

export function clearSessionCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set(X_SESSION_COOKIE, '', { ...sessionCookieOptions(request), maxAge: 0 });
  return response;
}

async function persistSession(session: XSession, sessionId?: string) {
  const id = sessionId ?? randomBase64Url();
  const payload = await sealXSession(session);
  const expiresAt = Date.now() + X_SESSION_TTL_MS;
  if (sessionId) {
    await saveXSessionRecord(id, session.profile.id, payload, expiresAt);
  } else {
    await replaceXSessionRecord(id, session.profile.id, payload, expiresAt);
  }
  return id;
}

async function refreshStoredSession(session: XSession, sessionId?: string) {
  try {
    const refreshed = await refreshXSession(session);
    const id = await persistSession(refreshed, sessionId);
    return { session: refreshed, renewedCookie: id };
  } catch (error) {
    if (error instanceof XRequestError && error.revoked) {
      if (sessionId) await deleteXSessionRecord(sessionId);
      return null;
    }
    throw error;
  }
}

const refreshing = new Map<string, Promise<{ session: XSession; renewedCookie?: string } | null>>();

export async function getStoredXSession(id: string) {
  const inFlight = refreshing.get(id);
  if (inFlight) return inFlight;
  const operation = (async () => {
    const stored = await loadXSessionRecord(id);
    if (!stored) return null;
    const session = await openXSession(stored.payload);
    if (!session) return null;
    if (session.expiresAt > Date.now() + 60_000) return { session };
    return refreshStoredSession(session, id);
  })();
  refreshing.set(id, operation);
  try { return await operation; } finally { refreshing.delete(id); }
}

export async function getActiveXSession(request: NextRequest): Promise<{
  session: XSession;
  renewedCookie?: string;
} | null> {
  const cookie = request.cookies.get(X_SESSION_COOKIE)?.value;
  if (!cookie) return null;

  if (cookie.includes('.')) {
    const session = await openXSession(cookie);
    if (!session) return null;
    if (session.expiresAt > Date.now() + 60_000) {
      return { session, renewedCookie: await persistSession(session) };
    }
    return refreshStoredSession(session);
  }

  return getStoredXSession(cookie);
}
