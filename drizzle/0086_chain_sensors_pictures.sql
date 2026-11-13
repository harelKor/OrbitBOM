-- Pictures for Chain and Sensors & vision (Harel, 2026-11-13), kept off any uploaded picture.
UPDATE "inventory_categories" SET "image" = '/categories/chain.png' WHERE "id" = 'chain' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/sensors.png' WHERE "id" = 'sensors' AND ("image" IS NULL OR "image" LIKE '/categories/%');
