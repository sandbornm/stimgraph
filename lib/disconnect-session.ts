import type { OwnerLock, RevocableSession } from './owner-revoke-delete.ts';

export async function disconnectPresentedSession<TSession extends RevocableSession>(input: {
  cookieValue?: string;
  withLock: OwnerLock;
  loadRow: (id: string) => Promise<{ ownerId: string; payload: string } | null>;
  openPayload: (payload: string) => Promise<TSession | null>;
  revoke: (session: TSession) => Promise<boolean>;
  deleteRow: (id: string) => Promise<unknown>;
  expireRow: (id: string) => Promise<unknown>;
}): Promise<{ revoked: boolean; clearCookie: boolean }> {
  const cookie = input.cookieValue;
  if (!cookie || cookie.includes('.')) return { revoked: false, clearCookie: true };
  const found = await input.loadRow(cookie);
  if (!found) return { revoked: false, clearCookie: true };
  return input.withLock(found.ownerId, async () => {
    const row = await input.loadRow(cookie);
    if (!row) {
      await input.deleteRow(cookie);
      return { revoked: false, clearCookie: true };
    }
    let session: TSession | null = null;
    try {
      session = await input.openPayload(row.payload);
    } catch {
      session = null;
    }
    if (!session) {
      await input.expireRow(cookie);
      return { revoked: false, clearCookie: false };
    }
    let revoked = false;
    try {
      revoked = await input.revoke(session);
    } catch {
      revoked = false;
    }
    if (revoked) {
      await input.deleteRow(cookie);
      return { revoked: true, clearCookie: true };
    }
    await input.expireRow(cookie);
    return { revoked: false, clearCookie: false };
  });
}
