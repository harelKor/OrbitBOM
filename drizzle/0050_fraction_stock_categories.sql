-- Tubes, shafts and filament also hold pieces (¼ ⅓ ½ ⅔ ¾), like plates (Harel, 2026-10-29).
UPDATE "inventory_categories" SET "sheet" = true WHERE "id" IN ('square-tubes', 'round-tubes', 'carbon-tubes', 'shafts', 'filament');
