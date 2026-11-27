import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  deleteXSessionRecord,
  loadXSessionRecord,
  replaceXSessionRecord,
  resealXSessionRecord,
  saveXSessionRecord,
  X_SESSION_TTL_MS,
} from '@/db/storage';
import { withOwnerWork } from './owner-work';
import { refreshXSession } from './x-api';
import { refreshErrorAction } from './x-errors';
import { requestOrigin } from './request-origin';
import { getRuntimeValue } from './runtime-env';
import {
  readSessionCookie,
  sessionCookieAttributes,
  sessionCookieWrites,
  stateCookieClearWrites,
  stateCookieSet,
  type CookieWrite,
} from './session-cookie';
import { resolveStoredXSession, SESSION_REFRESH_SKEW_MS, type StoredXSessionRow } from './x-session-resolve';
import { tokenKeyUsable } from './x-session-seal';
import { openXSession, randomBase64Url, sealXSession, type OpenedXSession, type XSession } from './x-session';

const SESSION_MAX_AGE_SECONDS = Math.floor(X_SESSION_TTL_MS / 1000);
const refreshing = new Map<string, Promise<{ session: XSession; renewedCookie?: string } | null>>();

export function sessionCookieOptions(request: NextRequest) {
  return sessionCookieAttributes(requestOrigin(request), SESSION_MAX_AGE_SECONDS);
}

function applyCookieWrites(response: NextResponse, request: NextRequest, writes: CookieWrite[]) {
  const base = sessionCookieOptions(request);
  for (const write of writes) {
    response.cookies.set(write.name, write.value, { ...base, secure: write.secure, maxAge: write.maxAge });
  }
  return response;
}

export function withRenewedSession(response: NextResponse, request: NextRequest, renewedCookie?: string) {
  const options = sessionCookieOptions(request);
  const read = readSessionCookie(request.cookies);
  return applyCookieWrites(response, request, sessionCookieWrites({
    secure: options.secure,
    maxAge: options.maxAge,
    renewedValue: renewedCookie,
    legacyAccepted: read.legacy,
    legacyValue: read.value,
    clear: false,
  }));
}

export function clearSessionCookie(response: NextResponse, request: NextRequest) {
  const options = sessionCookieOptions(request);
  return applyCookieWrites(response, request, sessionCookieWrites({
    secure: options.secure,
    maxAge: options.maxAge,
    clear: true,
  }));
}

export function assignStateCookie(response: NextResponse, request: NextRequest, value: string) {
  const options = sessionCookieOptions(request);
  const state = stateCookieSet(options.secure);
  response.cookies.set(state.name, value, { ...options, secure: state.secure, maxAge: state.maxAge });
  return response;
}

export function clearOauthStateCookie(response: NextResponse, request: NextRequest) {
  const options = sessionCookieOptions(request);
  return applyCookieWrites(response, request, stateCookieClearWrites(options.secure));
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

async function migrateLegacyPayload(id: string, stored: StoredXSessionRow, opened: OpenedXSession) {
  if (!opened.needsReseal || !tokenKeyUsable(getRuntimeValue)) return;
  const payload = await sealXSession(opened.session);
  await resealXSessionRecord(id, stored.ownerId, stored.payload, payload);
}

async function refreshStoredSession(session: XSession, sessionId?: string) {
  if (!tokenKeyUsable(getRuntimeValue)) return null;
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

function storedSessionDeps(lockHeld: boolean) {
  return {
    lockHeld,
    now: Date.now(),
    keyUsable: tokenKeyUsable(getRuntimeValue),
    load: (id: string) => loadXSessionRecord(id),
    open: (payload: string) => openXSession(payload),
    withLock: withOwnerWork,
    migrate: (id: string, row: StoredXSessionRow, opened: OpenedXSession) => migrateLegacyPayload(id, row, opened),
    refresh: (session: XSession, id: string) => refreshStoredSession(session, id),
  };
}

export async function getStoredXSession(id: string) {
  const inFlight = refreshing.get(id);
  if (inFlight) return inFlight;
  const operation = resolveStoredXSession({ id, ...storedSessionDeps(false) });
  refreshing.set(id, operation);
  try { return await operation; } finally { refreshing.delete(id); }
}

export async function getStoredXSessionLocked(id: string) {
  return resolveStoredXSession({ id, ...storedSessionDeps(true) });
}

export async function getActiveXSession(request: NextRequest): Promise<{
  session: XSession;
  renewedCookie?: string;
} | null> {
  if (!tokenKeyUsable(getRuntimeValue)) return null;
  const cookie = readSessionCookie(request.cookies).value;
  if (!cookie) return null;

  if (cookie.includes('.')) {
    const opened = await openXSession(cookie);
    if (!opened) return null;
    if (opened.session.expiresAt <= Date.now() + SESSION_REFRESH_SKEW_MS) {
      return withOwnerWork(opened.session.profile.id, () => refreshStoredSession(opened.session));
    }
    return { session: opened.session, renewedCookie: await persistSession(opened.session) };
  }

  return getStoredXSession(cookie);
}
