import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireRuntimeValue } from '@/lib/runtime-env';
import { exchangeAuthorizationCode, fetchXProfile } from '@/lib/x-api';
import {
  sealXSession,
  X_SESSION_COOKIE,
  X_STATE_COOKIE,
  X_VERIFIER_COOKIE,
} from '@/lib/x-session';

export const dynamic = 'force-dynamic';

function homeRedirect(request: NextRequest, state: string) {
  const ret = request.cookies.get('stim_return')?.value;
  const path = ret && /^\/s\/[A-Za-z0-9_-]{6,16}$/.test(ret) ? ret : '/';
  return new URL(`${path}?auth=${state}`, request.url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const returnedState = request.nextUrl.searchParams.get('state');
  const expectedState = request.cookies.get(X_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(X_VERIFIER_COOKIE)?.value;

  if (!code || !returnedState || !expectedState || !verifier || returnedState !== expectedState) {
    const response = NextResponse.redirect(homeRedirect(request, 'invalid'));
    response.cookies.delete('stim_return');
    return response;
  }

  try {
    const redirectUri = requireRuntimeValue('X_REDIRECT_URI');
    const token = await exchangeAuthorizationCode({ code, verifier, redirectUri });
    const profile = await fetchXProfile(token.access_token);
    const encryptedSession = await sealXSession({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      profile,
    });

    const response = NextResponse.redirect(homeRedirect(request, 'connected'));
    response.cookies.set(X_SESSION_COOKIE, encryptedSession, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
    });
    response.cookies.delete(X_STATE_COOKIE);
    response.cookies.delete(X_VERIFIER_COOKIE);
    response.cookies.delete('stim_return');
    return response;
  } catch {
    const response = NextResponse.redirect(homeRedirect(request, 'failed'));
    response.cookies.delete(X_STATE_COOKIE);
    response.cookies.delete(X_VERIFIER_COOKIE);
    response.cookies.delete('stim_return');
    return response;
  }
}
