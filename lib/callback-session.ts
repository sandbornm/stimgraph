export type CallbackToken = {
  accessToken: string;
  refreshToken?: string;
};

export function previousGrantReused(previous: CallbackToken, next: CallbackToken) {
  if (previous.accessToken === next.accessToken) return true;
  return Boolean(previous.refreshToken) && previous.refreshToken === next.refreshToken;
}

export async function storeCallbackSession(input: {
  ownerId: string;
  pendingCreatedAt: number;
  session: CallbackToken;
  sessionId: string;
  payload: string;
  expiresAt: number;
  ownerDeletedSince: (ownerId: string, since: number) => boolean | Promise<boolean>;
  loadRows: (ownerId: string) => Promise<{ id: string; payload: string }[]>;
  openPayload: (payload: string) => Promise<CallbackToken | null>;
  insert: (id: string, ownerId: string, payload: string, expiresAt: number, pendingCreatedAt: number) => Promise<boolean>;
  deleteRow: (id: string) => Promise<unknown>;
  expireRow: (id: string) => Promise<unknown>;
  revoke: (session: CallbackToken) => Promise<boolean>;
}): Promise<'stored' | 'rejected'> {
  if (await input.ownerDeletedSince(input.ownerId, input.pendingCreatedAt)) {
    try {
      await input.revoke(input.session);
    } catch {
      return 'rejected';
    }
    return 'rejected';
  }
  const previousRows = await input.loadRows(input.ownerId);
  const inserted = await input.insert(
    input.sessionId,
    input.ownerId,
    input.payload,
    input.expiresAt,
    input.pendingCreatedAt,
  );
  if (!inserted) return 'rejected';
  for (const row of previousRows) {
    let previous: CallbackToken | null;
    try {
      previous = await input.openPayload(row.payload);
    } catch {
      await input.expireRow(row.id);
      continue;
    }
    if (!previous) {
      await input.expireRow(row.id);
      continue;
    }
    if (previousGrantReused(previous, input.session)) {
      await input.deleteRow(row.id);
      continue;
    }
    let revoked = false;
    try {
      revoked = await input.revoke(previous);
    } catch {
      await input.expireRow(row.id);
      continue;
    }
    if (revoked) await input.deleteRow(row.id);
    else await input.expireRow(row.id);
  }
  return 'stored';
}
