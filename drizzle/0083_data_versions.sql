CREATE TABLE "data_versions" (
	"name" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- A table's counter goes up once per transaction that wrote it, when it commits (a deferred
-- trigger), so the new counter becomes visible together with the new rows. The advisory lock
-- makes committing writers bump one at a time, so two of them can't deadlock on the counters.
CREATE FUNCTION "bump_data_version"() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' OR current_setting('orbit.dv_' || TG_TABLE_NAME, true) IS DISTINCT FROM '1' THEN
    PERFORM set_config('orbit.dv_' || TG_TABLE_NAME, '1', true);
    PERFORM pg_advisory_xact_lock(1690);
    INSERT INTO "data_versions" ("name", "version") VALUES (TG_TABLE_NAME, 1)
      ON CONFLICT ("name") DO UPDATE SET "version" = "data_versions"."version" + 1;
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
INSERT INTO "data_versions" ("name") VALUES ('inventory_items'), ('inventory_categories'), ('base_materials'), ('parts'), ('systems'), ('robots'), ('members'), ('part_drawings'), ('part_reviews');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "inventory_items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "inventory_categories" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "base_materials" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "parts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "systems" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "robots" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OF "name" OR DELETE ON "members" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "part_drawings" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "data_version" AFTER INSERT OR UPDATE OR DELETE ON "part_reviews" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "inventory_items" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "inventory_categories" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "base_materials" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "parts" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "systems" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "robots" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "members" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "part_drawings" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();--> statement-breakpoint
CREATE TRIGGER "data_version_truncate" AFTER TRUNCATE ON "part_reviews" FOR EACH STATEMENT EXECUTE FUNCTION "bump_data_version"();
