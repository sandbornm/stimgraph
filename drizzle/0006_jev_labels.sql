CREATE TABLE IF NOT EXISTS `jev_topic_config` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`topics_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `jev_labels` (
	`owner_id` text NOT NULL,
	`post_id` text NOT NULL,
	`text_hash` text NOT NULL,
	`topics_hash` text NOT NULL,
	`label` text NOT NULL,
	`confidence` real NOT NULL,
	`model` text NOT NULL,
	`labeled_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `post_id`)
);
