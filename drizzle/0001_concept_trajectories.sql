CREATE TABLE IF NOT EXISTS `feeds` (
	`owner_id` text NOT NULL,
	`host` text NOT NULL,
	`page_url` text NOT NULL,
	`feeds_json` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`probed_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `host`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_feeds_owner_status` ON `feeds` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `follows` (
	`owner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`profile_image_url` text,
	`description` text,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_follows_owner_username` ON `follows` (`owner_id`,`username`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauth_pending` (
	`state` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`return_path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scouts` (
	`owner_id` text NOT NULL,
	`post_id` text NOT NULL,
	`author_username` text NOT NULL,
	`author_name` text NOT NULL,
	`text` text NOT NULL,
	`url` text,
	`topic_id` text,
	`topic_label` text NOT NULL,
	`reason` text NOT NULL,
	`confidence` integer DEFAULT 70 NOT NULL,
	`scouted_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `post_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_scouts_owner_scouted` ON `scouts` (`owner_id`,`scouted_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`capsule_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_shares_owner_created` ON `shares` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `trajectories` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`question` text NOT NULL,
	`steps_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_trajectories_owner_created` ON `trajectories` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `x_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_x_sessions_owner` ON `x_sessions` (`owner_id`);