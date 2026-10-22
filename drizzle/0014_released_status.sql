-- "Ready to Fab" is now called "Released": stored statuses and their history follow the new name.
UPDATE "parts" SET "design_state" = 'Released' WHERE "design_state" = 'Ready to Fab';--> statement-breakpoint
UPDATE "part_history" SET "new_value" = '"Released"'::jsonb WHERE "field" = 'designState' AND "new_value" = '"Ready to Fab"'::jsonb;--> statement-breakpoint
UPDATE "part_history" SET "old_value" = '"Released"'::jsonb WHERE "field" = 'designState' AND "old_value" = '"Ready to Fab"'::jsonb;
