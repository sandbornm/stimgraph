import { requireRuntimeValue } from './runtime-env';
import type { XProfile, XSession } from './x-session';
import { XRequestError, retryTime } from './x-errors';

const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';

type TokenResponse = {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope?: string;
  refresh_token?: string;
};

function basicAuthorization(): string {
  const clientId = encodeURIComponent(requireRuntimeValue('X_CLIENT_ID'));
  const clientSecret = encodeURIComponent(requireRuntimeValue('X_CLIENT_SECRET'));
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthorization(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error?: string };
    throw new XRequestError(response.status, retryTime(response), detail.error === 'invalid_grant');
  }

  return response.json() as Promise<TokenResponse>;
}

export async function exchangeAuthorizationCode({
  code,
  verifier,
  redirectUri,
}: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  return requestToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  );
}

export async function refreshXSession(session: XSession): Promise<XSession> {
  if (!session.refreshToken) {
    throw new Error('The X connection has expired and must be authorized again.');
  }

  const token = await requestToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    }),
  );

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
    profile: session.profile,
  };
}

export async function fetchXProfile(accessToken: string): Promise<XProfile> {
  const response = await fetch(
    'https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    throw new Error(`X profile lookup failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    data: {
      id: string;
      username: string;
      name: string;
      profile_image_url?: string;
    };
  };

  return {
    id: payload.data.id,
    username: payload.data.username,
    name: payload.data.name,
    profileImageUrl: payload.data.profile_image_url,
  };
}
