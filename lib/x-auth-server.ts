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
import { refreshErrorAction } from './x-errors';
import { requestOrigin } from './request-origin';
import { getRuntimeValue } from './runtime-env';
import { sessionCookieAttributes } from './session-cookie';
import { openXSession, randomBase64Url, sealXSession, X_SESSION_COOKIE, type OpenedXSession, type XSession } from './x-session';

const SESSION_MAX_AGE_SECONDS = Math.floor(X_SESSION_TTL_MS / 1000);

export function sessionCookieOptions(request: NextRequest) {
  return sessionCookieAttributes(requestOrigin(request), SESSION_MAX_AGE_SECONDS);
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

async function migrateLegacyPayload(id: string, stored: { ownerId: string; expiresAt: number }, opened: OpenedXSession) {
  if (!opened.needsReseal || !getRuntimeValue('STIMGRAPH_TOKEN_KEY')) return;
  const payload = await sealXSession(opened.session);
  await saveXSessionRecord(id, stored.ownerId, payload, stored.expiresAt);
}

async function refreshStoredSession(session: XSession, sessionId?: string) {
  try {
    const refreshed = await refreshXSession(session);
    const id = await persistSession(refreshed, sessionId);
    return { session: refreshed, renewedCookie: id };
  } catch (error) {
    if (refreshErrorAction(error) === 'delete') {
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
    const opened = await openXSession(stored.payload);
    if (!opened) return null;
    await migrateLegacyPayload(id, stored, opened);
    if (opened.session.expiresAt > Date.now() + 60_000) return { session: opened.session };
    return refreshStoredSession(opened.session, id);
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
    const opened = await openXSession(cookie);
    if (!opened) return null;
    if (opened.session.expiresAt <= Date.now() + 60_000) return refreshStoredSession(opened.session);
    if (!getRuntimeValue('STIMGRAPH_TOKEN_KEY')) return { session: opened.session };
    return { session: opened.session, renewedCookie: await persistSession(opened.session) };
  }

  return getStoredXSession(cookie);
}
