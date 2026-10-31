-- One Onshape version names a site version (src/lib/versions/label.ts), not every inserted
-- document's version joined with commas.
-- 1. Version names that are only the Commit window's prefill ("V82, Adding smart names, V2, …")
--    go back to empty, so the label alone shows.
UPDATE "system_versions" v SET "name" = NULL
WHERE v."name" LIKE '%, %'
  AND (SELECT array_agg(x ORDER BY x) FROM unnest(string_to_array(v."name", ', ')) x)
    = (SELECT array_agg(e.value->>'name' ORDER BY e.value->>'name') FROM jsonb_each(v."onshape_ref"->'sources') e);
--> statement-breakpoint
-- 2. Mark each version's documents with their part counts and the main one (most of the
--    system's parts), as detect.ts now does.
WITH counts AS (
  SELECT "system_id", "source_did" AS did, count(*)::int AS n FROM "parts"
  WHERE "source_did" IS NOT NULL AND NOT "is_manual" AND "removed_from_cad_at" IS NULL
  GROUP BY 1, 2
), mains AS (
  SELECT DISTINCT ON ("system_id") "system_id", did FROM counts ORDER BY "system_id", n DESC, did
)
UPDATE "system_versions" v SET "onshape_ref" = jsonb_set(v."onshape_ref", '{sources}', (
  SELECT jsonb_object_agg(e.key, e.value || jsonb_build_object(
    'parts', coalesce((SELECT n FROM counts c WHERE c."system_id" = v."system_id" AND c.did = e.key), 0),
    'main', coalesce(e.key = (SELECT did FROM mains m WHERE m."system_id" = v."system_id"), false)))
  FROM jsonb_each(v."onshape_ref"->'sources') e))
WHERE jsonb_typeof(v."onshape_ref"->'sources') = 'object' AND v."onshape_ref"->'sources' <> '{}'::jsonb;
--> statement-breakpoint
WITH counts AS (
  SELECT "system_id", "source_did" AS did, count(*)::int AS n FROM "parts"
  WHERE "source_did" IS NOT NULL AND NOT "is_manual" AND "removed_from_cad_at" IS NULL
  GROUP BY 1, 2
), mains AS (
  SELECT DISTINCT ON ("system_id") "system_id", did FROM counts ORDER BY "system_id", n DESC, did
)
UPDATE "system_versions" v SET "onshape_ref" = jsonb_set(v."onshape_ref", '{from}', (
  SELECT jsonb_object_agg(e.key, e.value || jsonb_build_object(
    'parts', coalesce((SELECT n FROM counts c WHERE c."system_id" = v."system_id" AND c.did = e.key), 0),
    'main', coalesce(e.key = (SELECT did FROM mains m WHERE m."system_id" = v."system_id"), false)))
  FROM jsonb_each(v."onshape_ref"->'from') e))
WHERE jsonb_typeof(v."onshape_ref"->'from') = 'object' AND v."onshape_ref"->'from' <> '{}'::jsonb;
--> statement-breakpoint
-- 3. Released parts' locked labels: the main version's name (else what came before the first
--    comma), and the version's cleaned name.
UPDATE "parts" p SET "released_snapshot" = p."released_snapshot" || jsonb_build_object(
  'versionLabel', coalesce(
    (SELECT e.value->>'name' FROM "system_versions" v, jsonb_each(v."onshape_ref"->'sources') e
     WHERE v."id" = p."released_version_id" AND (e.value->>'main')::boolean LIMIT 1),
    split_part(p."released_snapshot"->>'versionLabel', ', ', 1)),
  'versionName', (SELECT v."name" FROM "system_versions" v WHERE v."id" = p."released_version_id"))
WHERE p."released_snapshot"->>'versionLabel' LIKE '%, %';
