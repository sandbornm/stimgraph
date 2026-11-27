export const SESSION_REFRESH_SKEW_MS = 60_000;

export type StoredXSessionRow = {
  ownerId: string;
  payload: string;
  expiresAt: number;
};

export type ResolvedXSession<TSession> = {
  session: TSession;
  renewedCookie?: string;
};

export async function resolvePresentedXSession<TSession>(input: {
  cookie: string | undefined;
  keyUsable: boolean;
  loadStored: (id: string) => Promise<TSession | null>;
  openInline?: (cookie: string) => Promise<TSession | null>;
  persistInline?: (session: TSession) => Promise<string>;
  refreshInline?: (session: TSession) => Promise<TSession | null>;
}): Promise<TSession | null> {
  if (!input.cookie || input.cookie.includes('.') || !input.keyUsable) return null;
  return input.loadStored(input.cookie);
}

export async function resolveStoredXSession<TSession extends { expiresAt: number }>(input: {
  id: string;
  lockHeld: boolean;
  now: number;
  keyUsable: boolean;
  load: (id: string) => Promise<StoredXSessionRow | null>;
  open: (payload: string) => Promise<{ session: TSession; needsReseal: boolean } | null>;
  withLock: <T>(ownerId: string, action: () => Promise<T>) => Promise<T>;
  migrate: (id: string, row: StoredXSessionRow, opened: { session: TSession; needsReseal: boolean }) => Promise<void>;
  refresh: (session: TSession, id: string) => Promise<ResolvedXSession<TSession> | null>;
}): Promise<ResolvedXSession<TSession> | null> {
  if (!input.keyUsable) return null;

  const read = async () => {
    const row = await input.load(input.id);
    if (!row) return null;
    const opened = await input.open(row.payload);
    if (!opened) return null;
    return { row, opened };
  };

  const fresh = (session: TSession) => session.expiresAt > input.now + SESSION_REFRESH_SKEW_MS;

  const finish = async (row: StoredXSessionRow, opened: { session: TSession; needsReseal: boolean }) => {
    if (opened.needsReseal) await input.migrate(input.id, row, opened);
    if (fresh(opened.session)) return { session: opened.session };
    return input.refresh(opened.session, input.id);
  };

  const initial = await read();
  if (!initial) return null;
  if (fresh(initial.opened.session)) return finish(initial.row, initial.opened);

  const refreshLocked = async () => {
    const again = await read();
    if (!again) return null;
    return finish(again.row, again.opened);
  };

  if (input.lockHeld) return refreshLocked();
  return input.withLock(initial.row.ownerId, refreshLocked);
}
