CREATE INDEX IF NOT EXISTS `idx_bookmarks_owner_recent` ON `bookmarks` (`owner_id`, `created_at` DESC, `synced_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_bookmarks_owner_author_profile` ON `bookmarks` (`owner_id`, `author_id`, `author_username`, `author_name`, `author_profile_image_url`);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_bookmarks_owner_created`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_bookmarks_owner_author`;
