import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { saveOauthPending } from '@/db/storage';
import { getRuntimeValue, requireRuntimeValue } from '@/lib/runtime-env';
import { xAuthConfigured } from '@/lib/x-auth-config';
import { X_OAUTH_SCOPE } from '@/lib/x-oauth';
import { assignStateCookie } from '@/lib/x-auth-server';
import { createPkceChallenge, randomBase64Url } from '@/lib/x-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    if (!xAuthConfigured(getRuntimeValue)) throw new Error('Missing required server configuration');
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
      scope: X_OAUTH_SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();

    const response = NextResponse.redirect(authorizeUrl);
    assignStateCookie(response, request, state);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json(
      { error: 'The X connection is not configured on the server.' },
      { status: 503 },
    );
  }
}
