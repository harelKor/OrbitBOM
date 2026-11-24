ALTER TABLE "robots" ADD COLUMN "folder" text;--> statement-breakpoint
-- Archived robots move to the Old folder (Harel, 2026-11-24); the archived column is no longer read.
UPDATE "robots" SET "folder" = 'old' WHERE "archived";
