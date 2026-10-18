-- The app reads and writes the database only from the server, as the postgres role, which
-- bypasses row-level security. Turning RLS on with no policies keeps Supabase's public REST API
-- (reachable with the browser's anon key) from reading or writing any of these tables.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
--> statement-breakpoint
-- Starting inventory conditions and locations, copied from FRCBOM (ref §4). Edited from the Inventory toolbar afterwards.
INSERT INTO "inventory_conditions" ("label", "color") VALUES
  ('New', 'emerald'), ('Used', 'amber'), ('Old', 'rose'),
  ('For Robot A', 'emerald'), ('For Robot B', 'amber'), ('For Prototyping', 'amber')
ON CONFLICT ("label") DO NOTHING;
--> statement-breakpoint
INSERT INTO "inventory_locations" ("name") VALUES ('A1'), ('A2'), ('B2'), ('B3'), ('C1'), ('C5')
ON CONFLICT ("name") DO NOTHING;
