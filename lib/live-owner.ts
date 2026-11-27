export const ACCOUNT_DELETED_ERROR = 'The account was deleted.';

export type OwnerLock = <T>(ownerId: string, action: () => Promise<T>) => Promise<T>;

export type LiveOwnerDeps = {
  withLock: OwnerLock;
  hasSession: (ownerId: string) => Promise<boolean>;
};

export type LiveOwnerResult<T> =
  | { live: true; value: T }
  | { live: false; error: typeof ACCOUNT_DELETED_ERROR };

export async function withLiveOwner<T>(
  ownerId: string,
  write: () => Promise<T>,
  deps: LiveOwnerDeps,
): Promise<LiveOwnerResult<T>> {
  return deps.withLock(ownerId, async () => {
    if (!await deps.hasSession(ownerId)) return { live: false, error: ACCOUNT_DELETED_ERROR };
    return { live: true, value: await write() };
  });
}
