CREATE TABLE IF NOT EXISTS `bridge_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_bridge_requests_owner_created` ON `bridge_requests` (`owner_id`,`created_at`);