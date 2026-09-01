CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`profile_image_url` text,
	`connected_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookmark_topics` (
	`owner_id` text NOT NULL,
	`post_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`confidence` integer DEFAULT 100 NOT NULL,
	`evidence` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`owner_id`, `post_id`, `topic_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_bookmark_topics_owner_topic` ON `bookmark_topics` (`owner_id`,`topic_id`);--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`owner_id` text NOT NULL,
	`post_id` text NOT NULL,
	`author_id` text NOT NULL,
	`author_username` text NOT NULL,
	`author_name` text NOT NULL,
	`author_profile_image_url` text,
	`text` text NOT NULL,
	`created_at` text,
	`language` text,
	`entities_json` text DEFAULT '{}' NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `post_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_bookmarks_owner_author` ON `bookmarks` (`owner_id`,`author_id`);--> statement-breakpoint
CREATE INDEX `idx_bookmarks_owner_created` ON `bookmarks` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `topics` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`label` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_topics_owner_label` ON `topics` (`owner_id`,`label`);