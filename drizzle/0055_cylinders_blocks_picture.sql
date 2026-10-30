-- Cylinders & blocks gets its picture (Harel, 2026-10-30), unless the team already set one.
UPDATE "inventory_categories" SET "image" = '/categories/cylinders-blocks.png' WHERE "id" = 'cylinders-blocks' AND ("image" IS NULL OR "image" LIKE '/categories/%');
