export const DELETE_ACCOUNT_CONFIRMATION = 'delete my account';

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
