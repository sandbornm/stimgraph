ALTER TABLE `bookmark_sync_state` ADD `import_cursor` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_observations_owner_observed` ON `bookmark_observations` (`owner_id`, `observed_at`);
