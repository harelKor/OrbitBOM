ALTER TABLE "cad_updates" ALTER COLUMN "system_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cad_updates" ADD COLUMN "robot_id" uuid;--> statement-breakpoint
ALTER TABLE "cad_updates" ADD COLUMN "model" text DEFAULT 'final' NOT NULL;--> statement-breakpoint
ALTER TABLE "robots" ADD COLUMN "basepart_model_ref" jsonb;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "basepart_model_ref" jsonb;--> statement-breakpoint
ALTER TABLE "cad_updates" ADD CONSTRAINT "cad_updates_robot_id_robots_id_fk" FOREIGN KEY ("robot_id") REFERENCES "public"."robots"("id") ON DELETE cascade ON UPDATE no action;