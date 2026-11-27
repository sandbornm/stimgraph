const X_REVOKE_URL = 'https://api.x.com/2/oauth2/revoke';

export type RevocationResult = 'revoked' | 'failed';

export function classifyRevocation(status: number, bodyText: string): RevocationResult {
  if (status === 400 || status === 401) return 'revoked';
  if (status < 200 || status >= 300) return 'failed';
  const trimmed = bodyText.trim();
  if (!trimmed) return 'failed';
  try {
    JSON.parse(trimmed);
    return 'revoked';
  } catch {
    return 'failed';
  }
}

export async function requestTokenRevocation(input: {
  token: string;
  tokenTypeHint: 'refresh_token' | 'access_token';
  authorization: string;
  fetchImpl?: typeof fetch;
}): Promise<RevocationResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(X_REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: input.authorization,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: input.token, token_type_hint: input.tokenTypeHint }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    return classifyRevocation(response.status, await response.text());
  } catch {
    return 'failed';
  }
}

export async function revokeTokenPair(input: {
  accessToken: string;
  refreshToken?: string;
  authorization: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  let failed = false;
  if (input.refreshToken) {
    const refresh = await requestTokenRevocation({
      token: input.refreshToken,
      tokenTypeHint: 'refresh_token',
      authorization: input.authorization,
      fetchImpl: input.fetchImpl,
    });
    if (refresh === 'failed') failed = true;
  }
  const access = await requestTokenRevocation({
    token: input.accessToken,
    tokenTypeHint: 'access_token',
    authorization: input.authorization,
    fetchImpl: input.fetchImpl,
  });
  if (access === 'failed') failed = true;
  return !failed;
}
