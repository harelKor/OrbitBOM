ALTER TABLE "review_comments" ALTER COLUMN "state" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "review_comments" ALTER COLUMN "state" SET DEFAULT 'open'::text;--> statement-breakpoint
DROP TYPE "public"."review_comment_state";--> statement-breakpoint
UPDATE "review_comments" SET "state" = CASE "state" WHEN 'done' THEN 'to_check' WHEN 'approved' THEN 'done' ELSE "state" END;--> statement-breakpoint
CREATE TYPE "public"."review_comment_state" AS ENUM('open', 'on_it', 'to_check', 'done');--> statement-breakpoint
ALTER TABLE "review_comments" ALTER COLUMN "state" SET DEFAULT 'open'::"public"."review_comment_state";--> statement-breakpoint
ALTER TABLE "review_comments" ALTER COLUMN "state" SET DATA TYPE "public"."review_comment_state" USING "state"::"public"."review_comment_state";--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN "on_it_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN "on_it_by" uuid;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_on_it_by_members_id_fk" FOREIGN KEY ("on_it_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
