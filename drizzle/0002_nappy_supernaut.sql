ALTER TABLE "systems" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "refresh_member_id" uuid;--> statement-breakpoint
ALTER TABLE "systems" ADD CONSTRAINT "systems_refresh_member_id_members_id_fk" FOREIGN KEY ("refresh_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;