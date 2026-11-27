import { ACCOUNT_DELETED_ERROR, type LiveOwnerResult } from './live-owner.ts';

export async function labelRouteBookmarks<TPrepared, TValue>(
  ownerId: string,
  deps: {
    hasSession: (ownerId: string) => Promise<boolean>;
    prepare: () => Promise<TPrepared>;
    write: (prepared: TPrepared) => Promise<LiveOwnerResult<TValue>>;
  },
): Promise<LiveOwnerResult<TValue>> {
  if (!await deps.hasSession(ownerId)) return { live: false, error: ACCOUNT_DELETED_ERROR };
  const prepared = await deps.prepare();
  return deps.write(prepared);
}
