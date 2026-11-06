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
