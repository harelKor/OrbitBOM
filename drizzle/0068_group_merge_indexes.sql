CREATE INDEX "merges_system_idx" ON "merges" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "part_groups_robot_idx" ON "part_groups" USING btree ("robot_id");