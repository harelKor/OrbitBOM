ALTER TABLE "part_history" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "part_history" ADD COLUMN "page" text;--> statement-breakpoint
CREATE INDEX "part_history_visit_idx" ON "part_history" USING btree ("visit_id");