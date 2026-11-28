import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { deleteXSessionRecord, insertXSessionRecord, loadOwnerXSessionRows, ownerDeletedSince, takeOauthPending, X_SESSION_TTL_MS } from '@/db/storage';
import { storeCallbackSession } from '@/lib/callback-session';
import { withOwnerWork } from '@/lib/owner-work';
import { readStateCookie, sessionCookieSecure } from '@/lib/session-cookie';
import { clearOauthStateCookie, withRenewedSession } from '@/lib/x-auth-server';
import { requestOrigin } from '@/lib/request-origin';
import { getRuntimeValue, requireRuntimeValue } from '@/lib/runtime-env';
import { xAuthConfigured } from '@/lib/x-auth-config';
import { exchangeAuthorizationCode, fetchXProfile, revokeXSession } from '@/lib/x-api';
import { openXSession, randomBase64Url, sealXSession } from '@/lib/x-session';

export const dynamic = 'force-dynamic';

function sharePath(value: string | null | undefined) {
  return value && /^\/s\/[A-Za-z0-9_-]{6,16}$/.test(value) ? value : '/';
}

function homeRedirect(request: NextRequest, auth: string, returnPath?: string | null) {
  return new URL(`${sharePath(returnPath)}?auth=${auth}`, requestOrigin(request));
}

function htmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function connectedPage(request: NextRequest, sessionId: string, returnPath: string | null) {
  const dest = `${sharePath(returnPath)}?auth=connected`;
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stimgraph</title>
<style>
  html,body{margin:0;min-height:100%;background:#09090b;color:#ecece8;font:15px/1.45 ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center}
  a{color:inherit}
</style>
<body>
<p>Connected. <a href="${htmlEscape(dest)}">Open your map</a></p>
<script>location.replace(${JSON.stringify(dest)})</script>
</body>
</html>`;
  const response = new NextResponse(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
  withRenewedSession(response, request, sessionId);
  return clearOauthStateCookie(response, request);
}

export async function GET(request: NextRequest) {
  if (!xAuthConfigured(getRuntimeValue)) {
    return clearOauthStateCookie(NextResponse.json(
      { error: 'The X connection is not configured on the server.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    ), request);
  }
  const code = request.nextUrl.searchParams.get('code');
  const returnedState = request.nextUrl.searchParams.get('state');
  const browserState = readStateCookie(request.cookies, sessionCookieSecure(requestOrigin(request)));
  const pending = returnedState && browserState === returnedState ? await takeOauthPending(returnedState) : null;
  const returnPath = pending?.returnPath ?? null;

  if (!code || !returnedState || !pending || !pending.verifier) {
    return clearOauthStateCookie(NextResponse.redirect(homeRedirect(request, 'invalid', returnPath)), request);
  }

  try {
    const redirectUri = requireRuntimeValue('X_REDIRECT_URI');
    const token = await exchangeAuthorizationCode({ code, verifier: pending.verifier, redirectUri });
    const profile = await fetchXProfile(token.access_token);
    const sessionId = randomBase64Url();
    const payload = await sealXSession({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      profile,
    });
    const expiresAt = Date.now() + X_SESSION_TTL_MS;
    const stored = await withOwnerWork(profile.id, () => storeCallbackSession({
      ownerId: profile.id,
      pendingCreatedAt: pending.createdAt,
      session: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
      },
      sessionId,
      payload,
      expiresAt,
      ownerDeletedSince,
      loadRows: loadOwnerXSessionRows,
      openPayload: async (sealed) => (await openXSession(sealed))?.session ?? null,
      insert: insertXSessionRecord,
      deleteRow: deleteXSessionRecord,
      revoke: revokeXSession,
    }));
    if (stored === 'rejected') {
      return clearOauthStateCookie(NextResponse.redirect(homeRedirect(request, 'failed', returnPath)), request);
    }
    return connectedPage(request, sessionId, returnPath);
  } catch {
    return clearOauthStateCookie(NextResponse.redirect(homeRedirect(request, 'failed', returnPath)), request);
  }
}
