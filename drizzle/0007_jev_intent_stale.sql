-- Why-saved intent and actionable/stale flag from the same Jev call as the topic.
-- All columns are nullable: existing labels keep working and get signals on the next run
-- (rows with signals_at IS NULL are picked up once). NULL intent/stale = Jev was unsure (<0.5).
ALTER TABLE `jev_labels` ADD `intent` text;
--> statement-breakpoint
ALTER TABLE `jev_labels` ADD `intent_confidence` real;
--> statement-breakpoint
ALTER TABLE `jev_labels` ADD `stale` integer;
--> statement-breakpoint
ALTER TABLE `jev_labels` ADD `stale_confidence` real;
--> statement-breakpoint
ALTER TABLE `jev_labels` ADD `signals_at` integer;
