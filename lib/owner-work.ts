// The personal deployment uses one server process. Serialize deletion with its
// background importer so an in-flight fetch cannot recreate deleted data.
const state = globalThis as typeof globalThis & { stimgraphOwnerWork?: Map<string, Promise<unknown>> };
const work = state.stimgraphOwnerWork ??= new Map();

export async function withOwnerWork<T>(ownerId: string, action: () => Promise<T>): Promise<T> {
  const previous = work.get(ownerId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  work.set(ownerId, next);
  try { return await next; } finally { if (work.get(ownerId) === next) work.delete(ownerId); }
}
