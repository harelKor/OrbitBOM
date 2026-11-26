-- Egress (audit 2026-11-25 PERF-5/6): shop map places, material colours and system versions get a
-- data_versions counter, so Inventory pages, stock taps, item windows and the layout's every render
-- read them from the server's memory until one changes.
INSERT INTO "data_versions" ("name") VALUES ('inventory_locations'), ('material_colors'), ('system_versions') ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "inventory_locations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "inventory_locations" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "material_colors" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "material_colors" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "system_versions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "system_versions" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
