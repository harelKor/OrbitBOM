ALTER TABLE "parts" RENAME COLUMN "onshape_mv" TO "shape_sig";--> statement-breakpoint
UPDATE "parts" SET "shape_sig" = NULL;--> statement-breakpoint
-- Drafts found before shape fingerprints; the next check makes them again.
DELETE FROM "system_versions" WHERE "state" = 'draft';
