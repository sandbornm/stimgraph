// Kept separate from db/jev.ts to avoid an import cycle with db/storage.ts.
export const JEV_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jev_topic_config (
    owner_id TEXT PRIMARY KEY NOT NULL, topics_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jev_labels (
    owner_id TEXT NOT NULL, post_id TEXT NOT NULL, text_hash TEXT NOT NULL, topics_hash TEXT NOT NULL,
    label TEXT NOT NULL, confidence REAL NOT NULL, model TEXT NOT NULL, labeled_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, post_id)
  )`,
];

/** Additive columns from migration 0007 (why-saved intent + actionable/stale). Nullable, so existing rows stay valid. */
export const JEV_SIGNAL_COLUMNS = [
  'intent TEXT', 'intent_confidence REAL', 'stale INTEGER', 'stale_confidence REAL', 'signals_at INTEGER',
];

/** Migration 0008. Nullable unix ms; missing or older than 7 days is refreshed without relabeling topic or intent. */
export const JEV_STALE_EVAL_COLUMNS = ['stale_evaluated_at INTEGER'];
