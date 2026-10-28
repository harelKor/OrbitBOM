-- Pictures for the Gears, Pulleys and Belts boxes (Harel, 2026-10-28), served from public/categories/.
UPDATE "inventory_categories" SET "image" = '/categories/' || "id" || '.png' WHERE "id" IN ('gears', 'pulleys', 'belts');
