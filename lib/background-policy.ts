export const POLL_INTERVAL_MS = 6 * 60 * 60_000;
export const POLL_LEASE_MS = 4 * 60_000;

export function pollDelay(failures: number, retryAt = 0, now = Date.now()) {
  return Math.max(Math.min(24 * 60 * 60_000, POLL_INTERVAL_MS * 2 ** Math.min(10, failures)), retryAt - now);
}

export function activityQuery(params: URLSearchParams) {
  const after = Number(params.get('after') ?? '0');
  const limit = Number(params.get('limit') ?? '100');
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    return null;
  }
  return { after, limit };
}

export function trustedTailnetLogin(headers: Headers, login: string | undefined) {
  return Boolean(login && headers.get('tailscale-user-login') === login);
}
