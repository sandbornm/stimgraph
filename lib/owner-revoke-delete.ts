import { accountDeletionDecision, REVOKE_UNCONFIRMED_ERROR } from './delete-account.ts';

export type RevocableSession = {
  accessToken: string;
  refreshToken?: string;
};

export type OwnerLock = <T>(ownerId: string, action: () => Promise<T>) => Promise<T>;

export async function revokeAndDeleteOwner<TSession extends RevocableSession>(input: {
  ownerId: string;
  current: TSession | null;
  force: boolean;
  withLock: OwnerLock;
  loadPayloads: (ownerId: string) => Promise<string[]>;
  openPayload: (payload: string) => Promise<TSession | null>;
  revoke: (session: TSession) => Promise<boolean>;
  deleteData: (ownerId: string) => Promise<void>;
}): Promise<
  | { deleted: true; revoked: boolean }
  | { deleted: false; revoked: false; retryable: true; error: string }
> {
  return input.withLock(input.ownerId, async () => {
    const payloads = await input.loadPayloads(input.ownerId);
    const stored: TSession[] = [];
    let unopened = 0;
    for (const payload of payloads) {
      const session = await input.openPayload(payload);
      if (session) stored.push(session);
      else unopened += 1;
    }
    const sessions = stored.length > 0 ? stored : input.current === null ? [] : [input.current];
    const seen = new Set<string>();
    let allRevoked = true;
    for (const session of sessions) {
      const mark = `${session.refreshToken ?? ''}\n${session.accessToken}`;
      if (seen.has(mark)) continue;
      seen.add(mark);
      if (!await input.revoke(session)) allRevoked = false;
    }
    const decision = accountDeletionDecision({
      allRevoked,
      force: input.force,
      unopened: input.current === null ? unopened : 0,
    });
    if (!decision.delete) {
      return {
        deleted: false,
        revoked: false,
        retryable: true,
        error: 'error' in decision ? decision.error : REVOKE_UNCONFIRMED_ERROR,
      };
    }
    await input.deleteData(input.ownerId);
    return { deleted: true, revoked: decision.revoked };
  });
}

export async function deleteUnconfiguredAccount<TSession extends RevocableSession>(input: {
  clientCredentials: boolean;
  cookieValue?: string;
  ownerIdFromRow?: string | null;
  force: boolean;
  withLock: OwnerLock;
  loadPayloads: (ownerId: string) => Promise<string[]>;
  openPayload: (payload: string) => Promise<TSession | null>;
  revoke: (session: TSession) => Promise<boolean>;
  deleteData: (ownerId: string) => Promise<void>;
}): Promise<
  | { deleted: true; revoked: boolean; revokeSkipped?: 'not_configured' }
  | { deleted: false; status: 401; error: string }
  | { deleted: false; status: 502; error: string; revoked: false; retryable: true }
> {
  const decision = accountDeletionDecision({
    configured: false,
    clientCredentials: input.clientCredentials,
    allRevoked: false,
    force: input.force,
    cookieValue: input.cookieValue,
    ownerIdFromRow: input.ownerIdFromRow,
  });
  if (!decision.delete && 'attemptRevoke' in decision) {
    const outcome = await revokeAndDeleteOwner({
      ownerId: decision.ownerId,
      current: null,
      force: input.force,
      withLock: input.withLock,
      loadPayloads: input.loadPayloads,
      openPayload: input.openPayload,
      revoke: input.revoke,
      deleteData: input.deleteData,
    });
    if (!outcome.deleted) {
      return { deleted: false, status: 502, error: outcome.error, revoked: false, retryable: true };
    }
    return { deleted: true, revoked: outcome.revoked };
  }
  if (!decision.delete) {
    return { deleted: false, status: 401, error: 'error' in decision ? decision.error : 'Connect X first.' };
  }
  if (!('ownerId' in decision) || !('revokeSkipped' in decision)) {
    return { deleted: false, status: 401, error: 'Connect X first.' };
  }
  await input.withLock(decision.ownerId, () => input.deleteData(decision.ownerId));
  return { deleted: true, revoked: false, revokeSkipped: decision.revokeSkipped };
}
