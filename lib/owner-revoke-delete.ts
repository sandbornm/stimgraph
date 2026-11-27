import { accountDeletionDecision } from './delete-account.ts';

export type RevocableSession = {
  accessToken: string;
  refreshToken?: string;
};

export async function revokeAndDeleteOwner<TSession extends RevocableSession>(input: {
  ownerId: string;
  current: TSession;
  force: boolean;
  withLock: <T>(ownerId: string, action: () => Promise<T>) => Promise<T>;
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
    for (const payload of payloads) {
      const session = await input.openPayload(payload);
      if (session) stored.push(session);
    }
    const sessions = stored.length > 0 ? stored : [input.current];
    const seen = new Set<string>();
    let allRevoked = true;
    for (const session of sessions) {
      const mark = `${session.refreshToken ?? ''}\n${session.accessToken}`;
      if (seen.has(mark)) continue;
      seen.add(mark);
      if (!await input.revoke(session)) allRevoked = false;
    }
    const decision = accountDeletionDecision({ allRevoked, force: input.force });
    if (!decision.delete) {
      return { deleted: false, revoked: false, retryable: true, error: decision.error };
    }
    await input.deleteData(input.ownerId);
    return { deleted: true, revoked: decision.revoked };
  });
}
