import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { saveOauthPending } from '@/db/storage';
import { requireRuntimeValue } from '@/lib/runtime-env';
import { createPkceChallenge, randomBase64Url, X_STATE_COOKIE } from '@/lib/x-session';
import { sessionCookieOptions } from '@/lib/x-auth-server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const clientId = requireRuntimeValue('X_CLIENT_ID');
    const redirectUri = requireRuntimeValue('X_REDIRECT_URI');
    const state = randomBase64Url();
    const verifier = randomBase64Url(48);
    const challenge = await createPkceChallenge(verifier);
    const returnParam = new URL(request.url).searchParams.get('return');
    const returnPath = returnParam && /^\/s\/[A-Za-z0-9_-]{6,16}$/.test(returnParam) ? returnParam : null;
    await saveOauthPending(state, verifier, returnPath);

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
    response.cookies.set(X_STATE_COOKIE, state, { ...sessionCookieOptions(request), maxAge: 600 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json(
      { error: 'The X connection is not configured on the server.' },
      { status: 503 },
    );
  }
}
