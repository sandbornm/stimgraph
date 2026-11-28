export type OwnerTable = {
  table: string;
  column: 'id' | 'owner_id';
};

export const OWNER_SCOPED_TABLES: readonly OwnerTable[] = [
  { table: 'bookmark_observations', column: 'owner_id' },
  { table: 'bookmark_sync_state', column: 'owner_id' },
  { table: 'bookmark_topics', column: 'owner_id' },
  { table: 'jev_labels', column: 'owner_id' },
  { table: 'jev_topic_config', column: 'owner_id' },
  { table: 'topics', column: 'owner_id' },
  { table: 'bookmarks', column: 'owner_id' },
  { table: 'scouts', column: 'owner_id' },
  { table: 'follows', column: 'owner_id' },
  { table: 'feeds', column: 'owner_id' },
  { table: 'shares', column: 'owner_id' },
  { table: 'trajectories', column: 'owner_id' },
  { table: 'bridge_requests', column: 'owner_id' },
  { table: 'research_cards', column: 'owner_id' },
  { table: 'research_requests', column: 'owner_id' },
  { table: 'x_sessions', column: 'owner_id' },
  { table: 'accounts', column: 'id' },
];

export const NON_OWNER_TABLES = [
  {
    table: 'oauth_pending',
    reason: 'Keyed by OAuth state, not an owner. Rows hold short-lived PKCE verifiers.',
  },
  {
    table: 'background_health',
    reason: 'Singleton scheduler heartbeat, not user-scoped.',
  },
  {
    table: 'deleted_owners',
    reason: 'Retained so a sign-in started before the delete cannot recreate the account.',
  },
  {
    table: 'schema_events',
    reason: 'One-time schema flags, not an owner account.',
  },
] as const;

function ident(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return value;
}

export function ownerDeleteStatements() {
  return OWNER_SCOPED_TABLES.map((entry) => `DELETE FROM ${ident(entry.table)} WHERE ${ident(entry.column)} = ?`);
}
