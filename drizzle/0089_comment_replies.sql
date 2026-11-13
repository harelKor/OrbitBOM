CREATE TABLE "review_comment_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_comment_replies" ADD CONSTRAINT "review_comment_replies_comment_id_review_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."review_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comment_replies" ADD CONSTRAINT "review_comment_replies_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_comment_replies_comment_idx" ON "review_comment_replies" USING btree ("comment_id","created_at");--> statement-breakpoint
ALTER TABLE "review_comment_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- A mentor's "sent back" note is now a reply in the thread: bring the existing ones over.
INSERT INTO "review_comment_replies" ("comment_id", "author_id", "body", "created_at")
SELECT "id", "rejected_by", "reject_note", coalesce("rejected_at", now()) FROM "review_comments" WHERE "reject_note" IS NOT NULL AND "reject_note" <> '';
