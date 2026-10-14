-- When the actionable/stale label was last evaluated (unix ms).
-- Nullable: existing labels stay valid. A missing value, or one older than 7 days, is re-asked
-- on the next run. Topic and intent are left as they are. ensureSchema ignores "duplicate column".
ALTER TABLE `jev_labels` ADD `stale_evaluated_at` integer;
