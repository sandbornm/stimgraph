import type { OwnerLock, RevocableSession } from './owner-revoke-delete.ts';

export async function disconnectPresentedSession<TSession extends RevocableSession>(input: {
  cookieValue?: string;
  withLock: OwnerLock;
  loadRow: (id: string) => Promise<{ ownerId: string; payload: string } | null>;
  openPayload: (payload: string) => Promise<TSession | null>;
  revoke: (session: TSession) => Promise<boolean>;
  deleteRow: (id: string) => Promise<unknown>;
}): Promise<{ revoked: boolean }> {
  const cookie = input.cookieValue;
  if (!cookie || cookie.includes('.')) return { revoked: false };
  const found = await input.loadRow(cookie);
  if (!found) return { revoked: false };
  return input.withLock(found.ownerId, async () => {
    const row = await input.loadRow(cookie);
    let session: TSession | null = null;
    if (row) {
      try {
        session = await input.openPayload(row.payload);
      } catch {
        session = null;
      }
    }
    let revoked = false;
    if (session) {
      try {
        revoked = await input.revoke(session);
      } catch {
        revoked = false;
      }
    }
    await input.deleteRow(cookie);
    return { revoked };
  });
}
