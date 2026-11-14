CREATE INDEX "cad_updates_robot_idx" ON "cad_updates" USING btree ("robot_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_moves_part_idx" ON "inventory_moves" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_releases_version_idx" ON "part_releases" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "parts_stage_at_idx" ON "parts" USING btree ("stage_at");--> statement-breakpoint
CREATE INDEX "parts_released_version_idx" ON "parts" USING btree ("released_version_id");--> statement-breakpoint
CREATE INDEX "review_comments_done_version_idx" ON "review_comments" USING btree ("done_version_id");--> statement-breakpoint
-- Inventory's groups and conditions join the tables the server's memory cache watches
-- (src/lib/data/cache.ts, migration 0083).
INSERT INTO "data_versions" ("name") VALUES ('inventory_groups'), ('inventory_conditions') ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "inventory_groups" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "inventory_conditions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "inventory_groups" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "inventory_conditions" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
