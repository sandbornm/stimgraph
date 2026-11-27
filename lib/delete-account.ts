export const DELETE_ACCOUNT_CONFIRMATION = 'delete my account';

export const REVOKE_UNCONFIRMED_ERROR = 'X did not confirm that access was revoked. Nothing was deleted; try again.';

export type AccountDeletionDecision =
  | { delete: true; revoked: boolean }
  | { delete: false; status: 502; error: string; revoked: false; retryable: true };

export function accountDeletionDecision(input: { allRevoked: boolean; force: boolean }): AccountDeletionDecision {
  if (input.allRevoked) return { delete: true, revoked: true };
  if (input.force) return { delete: true, revoked: false };
  return {
    delete: false,
    status: 502,
    error: REVOKE_UNCONFIRMED_ERROR,
    revoked: false,
    retryable: true,
  };
}

export function deleteAccountRequestAllowed(input: {
  origin: string | null;
  requestOrigin: string;
  secFetchSite: string | null;
  confirm: unknown;
}) {
  const originAllowed = input.origin
    ? input.origin === input.requestOrigin
    : input.secFetchSite === 'same-origin';
  return originAllowed && input.confirm === DELETE_ACCOUNT_CONFIRMATION;
}
