CREATE TABLE IF NOT EXISTS `research_cards` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`card_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_research_cards_owner_created` ON `research_cards` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `research_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_research_requests_owner_kind_created` ON `research_requests` (`owner_id`,`kind`,`created_at`);