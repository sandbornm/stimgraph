CREATE INDEX IF NOT EXISTS `idx_bookmarks_owner_imported` ON `bookmarks` (`owner_id`, `synced_at`, `created_at`, `post_id`);
