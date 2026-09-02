import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireRuntimeValue } from '@/lib/runtime-env';
import {
  createPkceChallenge,
  randomBase64Url,
  X_STATE_COOKIE,
  X_VERIFIER_COOKIE,
} from '@/lib/x-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const clientId = requireRuntimeValue('X_CLIENT_ID');
    const redirectUri = requireRuntimeValue('X_REDIRECT_URI');
    const state = randomBase64Url();
    const verifier = randomBase64Url(48);
    const challenge = await createPkceChallenge(verifier);
    const authorizeUrl = new URL('https://x.com/i/oauth2/authorize');

    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'tweet.read users.read bookmark.read follows.read offline.access',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();

    const response = NextResponse.redirect(authorizeUrl);
    const cookieOptions = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 10 * 60,
    };
    response.cookies.set(X_STATE_COOKIE, state, cookieOptions);
    response.cookies.set(X_VERIFIER_COOKIE, verifier, cookieOptions);
    const returnPath = new URL(request.url).searchParams.get('return');
    if (returnPath && /^\/s\/[A-Za-z0-9_-]{6,16}$/.test(returnPath)) {
      response.cookies.set('stim_return', returnPath, cookieOptions);
    }
    return response;
  } catch {
    return NextResponse.json(
      { error: 'The X connection is not configured on the server.' },
      { status: 503 },
    );
  }
}
