CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`email_id` text NOT NULL,
	`filename` text,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`r2_key` text NOT NULL,
	`content_id` text,
	`disposition` text,
	`sha256` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`email_id`) REFERENCES `email`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `attachment_r2_key_unique` ON `attachment` (`r2_key`);
CREATE INDEX `attachment_message_id_idx` ON `attachment` (`message_id`);
CREATE INDEX `attachment_email_id_idx` ON `attachment` (`email_id`);
CREATE INDEX `attachment_created_at_idx` ON `attachment` (`created_at`);
