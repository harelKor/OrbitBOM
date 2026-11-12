ALTER TABLE "review_comments" ADD COLUMN "model" text DEFAULT 'final' NOT NULL;--> statement-breakpoint
ALTER TABLE "robots" ADD COLUMN "basepart_url" text;--> statement-breakpoint
ALTER TABLE "robots" ADD COLUMN "basepart_kind" text;--> statement-breakpoint
ALTER TABLE "robots" ADD COLUMN "basepart_studio_url" text;--> statement-breakpoint
ALTER TABLE "robots" ADD COLUMN "basepart_sketches" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "basepart_url" text;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "basepart_kind" text;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "basepart_studio_url" text;--> statement-breakpoint
ALTER TABLE "systems" ADD COLUMN "basepart_sketches" jsonb DEFAULT '[]'::jsonb NOT NULL;