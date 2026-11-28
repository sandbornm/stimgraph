export type ExchangedGrant = {
  accessToken: string;
  refreshToken?: string;
};

export async function settleExchangedGrant<TSession extends ExchangedGrant>(input: {
  session: TSession;
  outcome: 'stored' | 'rejected' | 'failed';
  revoke: (session: TSession) => Promise<boolean>;
  recordPending: (session: TSession) => Promise<void>;
}): Promise<'stored' | 'rejected' | 'failed'> {
  if (input.outcome === 'stored') return 'stored';
  let revoked = false;
  try {
    revoked = await input.revoke(input.session);
  } catch {
    revoked = false;
  }
  if (revoked) return input.outcome === 'rejected' ? 'rejected' : 'failed';
  try {
    await input.recordPending(input.session);
  } catch {
    return input.outcome === 'rejected' ? 'rejected' : 'failed';
  }
  return input.outcome === 'rejected' ? 'rejected' : 'failed';
}

export async function finishExchangedGrant<TSession extends ExchangedGrant>(input: {
  session: TSession;
  finish: () => Promise<'stored' | 'rejected'>;
  revoke: (session: TSession) => Promise<boolean>;
  recordPending: (session: TSession) => Promise<void>;
}): Promise<'stored' | 'rejected' | 'failed'> {
  let outcome: 'stored' | 'rejected' | 'failed';
  try {
    outcome = await input.finish();
  } catch {
    outcome = 'failed';
  }
  return settleExchangedGrant({
    session: input.session,
    outcome,
    revoke: input.revoke,
    recordPending: input.recordPending,
  });
}
