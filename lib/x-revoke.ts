const X_REVOKE_URL = 'https://api.x.com/2/oauth2/revoke';

export function revocationConfirmed(status: number, body: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  if (body !== null && typeof body === 'object' && 'revoked' in body && body.revoked === false) return false;
  return true;
}

export async function requestTokenRevocation(input: {
  token: string;
  tokenTypeHint: 'refresh_token' | 'access_token';
  authorization: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
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
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined);
      return false;
    }
    const text = await response.text();
    if (!text.trim()) return true;
    try {
      return revocationConfirmed(response.status, JSON.parse(text) as unknown);
    } catch {
      return true;
    }
  } catch {
    return false;
  }
}
