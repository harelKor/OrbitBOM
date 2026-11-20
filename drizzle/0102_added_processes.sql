ALTER TABLE "parts" ADD COLUMN "added_processes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "qa_held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "cots_qa" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Process 2 becomes the first added process, QA off (Harel, 2026-11-20). process2 / done_process2
-- stay until a later push drops them.
UPDATE "parts" SET "added_processes" = jsonb_build_array(jsonb_build_object('machine', "process2", 'done', "done_process2", 'qa', false, 'qaDone', false)) WHERE "process2" IS NOT NULL AND "added_processes" = '[]'::jsonb;--> statement-breakpoint
-- "Ready for Process 2" is now "Released P2"; a part with no Process 2 is back in Process 1.
UPDATE "parts" SET "design_state" = CASE WHEN "process2" IS NOT NULL THEN 'Released P2' ELSE 'In Process 1' END WHERE "design_state" = 'Ready for Process 2';
