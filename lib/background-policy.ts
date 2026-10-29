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

export const BACKFILL_LIMIT = 800;
export const BACKFILL_PAGE_SIZE = 100;

export function nextPageStep({ backfill, inserted, received, nextToken, fetched }: {
  backfill: boolean; inserted: number; received: number; nextToken?: string | null; fetched: number;
}): { continuation: string | null; stop: boolean; backfillDone: boolean } {
  if (backfill) {
    const exhausted = !nextToken || received === 0 || fetched >= BACKFILL_LIMIT;
    return { continuation: exhausted ? null : nextToken!, stop: exhausted, backfillDone: exhausted };
  }
  const overlap = inserted < received;
  const continuation = overlap ? null : nextToken ?? null;
  return { continuation, stop: overlap || !continuation, backfillDone: false };
}
