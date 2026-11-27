export const DELETE_ACCOUNT_CONFIRMATION = 'delete my account';

export const REVOKE_UNCONFIRMED_ERROR = 'X did not confirm that access was revoked. Nothing was deleted; try again.';

export type AccountDeletionDecision =
  | { delete: true; revoked: true }
  | { delete: true; revoked: false }
  | { delete: true; revoked: false; revokeSkipped: 'not_configured'; ownerId: string }
  | { delete: false; attemptRevoke: true; ownerId: string }
  | { delete: false; status: 502; error: string; revoked: false; retryable: true }
  | { delete: false; status: 401; error: string };

export function accountDeletionDecision(input: {
  allRevoked: boolean;
  force: boolean;
  configured?: boolean;
  clientCredentials?: boolean;
  unopened?: number;
  cookieValue?: string;
  ownerIdFromRow?: string | null;
}): AccountDeletionDecision {
  if (input.configured === false) {
    if (!input.cookieValue || input.cookieValue.includes('.') || !input.ownerIdFromRow) {
      return { delete: false, status: 401, error: 'Connect X first.' };
    }
    if (input.clientCredentials) {
      return { delete: false, attemptRevoke: true, ownerId: input.ownerIdFromRow };
    }
    return {
      delete: true,
      revoked: false,
      revokeSkipped: 'not_configured',
      ownerId: input.ownerIdFromRow,
    };
  }
  const confirmed = input.allRevoked && (input.unopened ?? 0) === 0;
  if (confirmed) return { delete: true, revoked: true };
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
