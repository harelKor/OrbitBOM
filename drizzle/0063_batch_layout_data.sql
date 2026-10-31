ALTER TABLE "part_groups" ADD COLUMN "layout_data" jsonb;--> statement-breakpoint
ALTER TABLE "robots" ADD COLUMN "layouts_document_url" text;--> statement-breakpoint
ALTER TABLE "robots" ADD COLUMN "layouts_document_id" text;--> statement-breakpoint
ALTER TABLE "robots" ADD COLUMN "layouts_workspace_id" text;--> statement-breakpoint
UPDATE "part_groups" SET "layout_data" = jsonb_build_object('onshape', ("onshape_layout" - 'at') || jsonb_build_object('url', ("onshape_layout"->>'baseUrl') || '/documents/' || ("onshape_layout"->>'did') || '/w/' || ("onshape_layout"->>'wid') || '/e/' || ("onshape_layout"->>'eid'), 'createdAt', "onshape_layout"->>'at')) WHERE "onshape_layout" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "part_groups" DROP COLUMN "onshape_layout";
