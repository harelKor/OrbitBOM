-- Pictures for the Sprockets, Bearings and Pinions & adapters boxes (Harel, 2026-10-28), served from public/categories/.
UPDATE "inventory_categories" SET "image" = '/categories/' || "id" || '.png' WHERE "id" IN ('sprockets', 'bearings', 'pinions-adapters');
