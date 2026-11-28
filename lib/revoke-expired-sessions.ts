export async function revokeExpiredSessions<TSession>(input: {
  now: number;
  loadExpired: (now: number) => Promise<{ id: string; ownerId: string; payload: string }[]>;
  withLock: <T>(ownerId: string, action: () => Promise<T>) => Promise<T>;
  openPayload: (payload: string) => Promise<TSession | null>;
  revoke: (session: TSession) => Promise<boolean>;
  deleteRow: (id: string) => Promise<unknown>;
}) {
  const rows = await input.loadExpired(input.now);
  for (const row of rows) {
    if (!row.payload) continue;
    await input.withLock(row.ownerId, async () => {
      let session: TSession | null = null;
      try {
        session = await input.openPayload(row.payload);
      } catch {
        session = null;
      }
      if (!session) return;
      let revoked = false;
      try {
        revoked = await input.revoke(session);
      } catch {
        revoked = false;
      }
      if (revoked) await input.deleteRow(row.id);
    });
  }
}
