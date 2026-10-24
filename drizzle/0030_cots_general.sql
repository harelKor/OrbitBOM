ALTER TABLE "parts" ALTER COLUMN "system_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "robot_id" uuid;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "cots_in_stock_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "cots_cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parts_robot_idx" ON "parts" USING btree ("robot_id");--> statement-breakpoint
UPDATE "parts" SET "cots_in_stock_at" = now() WHERE "classification" = 'cots' AND "design_state" = 'In Stock';