import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { replaceXSessionRecord, takeOauthPending, X_SESSION_TTL_MS } from '@/db/storage';
import { sessionCookieOptions } from '@/lib/x-auth-server';
import { requestOrigin } from '@/lib/request-origin';
import { requireRuntimeValue } from '@/lib/runtime-env';
import { exchangeAuthorizationCode, fetchXProfile } from '@/lib/x-api';
import { randomBase64Url, sealXSession, X_SESSION_COOKIE, X_STATE_COOKIE } from '@/lib/x-session';

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
  response.cookies.set(X_SESSION_COOKIE, sessionId, sessionCookieOptions(request));
  response.cookies.set(X_STATE_COOKIE, '', { ...sessionCookieOptions(request), maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const returnedState = request.nextUrl.searchParams.get('state');
  const browserState = request.cookies.get(X_STATE_COOKIE)?.value;
  const pending = returnedState && browserState === returnedState ? await takeOauthPending(returnedState) : null;
  const verifier = pending?.verifier;
  const returnPath = pending?.returnPath ?? null;

  if (!code || !returnedState || !verifier) {
    return NextResponse.redirect(homeRedirect(request, 'invalid', returnPath));
  }

  try {
    const redirectUri = requireRuntimeValue('X_REDIRECT_URI');
    const token = await exchangeAuthorizationCode({ code, verifier, redirectUri });
    const profile = await fetchXProfile(token.access_token);
    const sessionId = randomBase64Url();
    const payload = await sealXSession({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      profile,
    });
    await replaceXSessionRecord(sessionId, profile.id, payload, Date.now() + X_SESSION_TTL_MS);
    return connectedPage(request, sessionId, returnPath);
  } catch {
    const response = NextResponse.redirect(homeRedirect(request, 'failed', returnPath));
    response.cookies.set(X_STATE_COOKIE, '', { ...sessionCookieOptions(request), maxAge: 0 });
    return response;
  }
}
