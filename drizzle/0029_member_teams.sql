CREATE TYPE "public"."member_team" AS ENUM('build', 'cad');--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "team" "member_team";--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "system_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE set null ON UPDATE no action;