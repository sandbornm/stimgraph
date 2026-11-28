export function presentedRevocationPending(input: {
  connected: boolean;
  row: { payload: string; expiresAt: number } | null;
  now: number;
}) {
  if (input.connected || !input.row || input.row.payload.length === 0) return false;
  return input.row.expiresAt <= input.now;
}
