-- Fire any deferred data_version trigger events still pending (a fresh database runs every
-- migration in one transaction), which would block ALTER TABLE on inventory_items.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "season_need_new" double precision;--> statement-breakpoint
SET CONSTRAINTS ALL DEFERRED;
