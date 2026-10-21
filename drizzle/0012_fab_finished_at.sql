ALTER TABLE "parts" ADD COLUMN "fab_finished_at" timestamp with time zone;--> statement-breakpoint
-- Parts already made (an in-house part with a machine, in a done status) start in Finished.
UPDATE "parts" SET "fab_finished_at" = now()
WHERE "classification" <> 'cots'
  AND coalesce("pre_process", "process1", "process2") IS NOT NULL
  AND (
    ("done_preprocess" = 0 AND "done_process1" = 0 AND "done_process2" = 0
      AND "design_state" IN ('Ready for QA', 'In Stock', 'In Spare Stock'))
    OR (("done_preprocess" > 0 OR "done_process1" > 0 OR "done_process2" > 0)
      AND ("pre_process" IS NULL OR "done_preprocess" >= greatest("quantity", 1))
      AND ("process1" IS NULL OR "done_process1" >= greatest("quantity", 1))
      AND ("process2" IS NULL OR "done_process2" >= greatest("quantity", 1)))
  );
