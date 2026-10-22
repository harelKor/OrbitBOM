ALTER TABLE "parts" ADD COLUMN "cots_links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "unit_price" real;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "cots_category" text;--> statement-breakpoint
ALTER TABLE "parts" ADD COLUMN "stock_count" integer DEFAULT 0 NOT NULL;