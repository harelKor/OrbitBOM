ALTER TABLE "inventory_items" ADD COLUMN "season_tag" text DEFAULT '2027' NOT NULL;--> statement-breakpoint
-- Items already on the shelf are last season's list until someone checks them, except plates and
-- box tubes, which Harel pre-approved for 2027 (2026-10-30). New items keep the '2027' default.
UPDATE "inventory_items" SET "season_tag" = '2026' WHERE "category" IS NULL OR "category" NOT IN ('aluminum-plates', 'square-tubes');
