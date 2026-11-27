const state = globalThis as typeof globalThis & { stimgraphOwnerDeletions?: Map<string, number> };
const deletions = state.stimgraphOwnerDeletions ??= new Map<string, number>();

export function recordOwnerDeleted(ownerId: string, at: number) {
  const previous = deletions.get(ownerId);
  if (previous === undefined || at >= previous) deletions.set(ownerId, at);
}

export function ownerDeletedSince(ownerId: string, since: number) {
  const at = deletions.get(ownerId);
  return at !== undefined && at >= since;
}
