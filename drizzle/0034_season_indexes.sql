CREATE INDEX "group_members_part_idx" ON "group_members" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_reviews_batch_idx" ON "part_reviews" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "parts_inventory_item_idx" ON "parts" USING btree ("inventory_item_id");