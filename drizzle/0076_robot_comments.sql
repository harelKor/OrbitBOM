ALTER TABLE "review_comments" ALTER COLUMN "system_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN "robot_id" uuid;--> statement-breakpoint
UPDATE "review_comments" c SET "robot_id" = s."robot_id" FROM "systems" s WHERE s."id" = c."system_id";--> statement-breakpoint
ALTER TABLE "review_comments" ALTER COLUMN "robot_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_comments_robot_idx" ON "review_comments" USING btree ("robot_id","created_at");
