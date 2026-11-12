CREATE TABLE "bores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bores_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "bores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Categories read through the cache (src/lib/data/cache.ts) merge the Bore list in, so its
-- changes bump a counter like base_materials (migration 0083).
INSERT INTO "data_versions" ("name") VALUES ('bores') ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "bores" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "bores" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
