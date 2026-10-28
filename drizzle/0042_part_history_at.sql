DROP INDEX "part_history_part_idx";--> statement-breakpoint
CREATE INDEX "part_history_part_at_idx" ON "part_history" USING btree ("part_id","at");--> statement-breakpoint
CREATE INDEX "part_history_at_idx" ON "part_history" USING btree ("at");