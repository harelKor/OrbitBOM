CREATE TABLE "deleted_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"rows" jsonb NOT NULL,
	"file_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"deleted_by" uuid,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deleted_records" ADD CONSTRAINT "deleted_records_deleted_by_members_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deleted_records_at_idx" ON "deleted_records" USING btree ("deleted_at");--> statement-breakpoint
ALTER TABLE "deleted_records" ENABLE ROW LEVEL SECURITY;
