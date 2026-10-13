CREATE TABLE IF NOT EXISTS `background_health` (
	`id` integer PRIMARY KEY NOT NULL,
	`heartbeat_at` integer NOT NULL,
	CONSTRAINT "background_health_singleton" CHECK("background_health"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `bookmark_observations` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`post_id` text NOT NULL,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_observations_owner_post` ON `bookmark_observations` (`owner_id`,`post_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_observations_owner_sequence` ON `bookmark_observations` (`owner_id`,`sequence`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `bookmark_sync_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`next_poll_at` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_started_at` integer,
	`last_succeeded_at` integer,
	`status` text DEFAULT 'waiting' NOT NULL,
	`fetched` integer DEFAULT 0 NOT NULL,
	`continuation` text
);
