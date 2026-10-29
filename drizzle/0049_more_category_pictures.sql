-- Pictures for round tubes, carbon fiber tubes and motors (Harel, 2026-10-29), kept off any uploaded picture.
UPDATE "inventory_categories" SET "image" = '/categories/round-tubes.png' WHERE "id" = 'round-tubes' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/carbon-tubes.png' WHERE "id" = 'carbon-tubes' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/motors.png' WHERE "id" = 'motors' AND ("image" IS NULL OR "image" LIKE '/categories/%');
