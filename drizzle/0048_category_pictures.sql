-- Pictures for the inventory category boxes (Harel, 2026-10-29). Sets a category's picture only
-- when it has none or still uses a bundled one, so a picture someone uploaded is kept.
UPDATE "inventory_categories" SET "image" = '/categories/aluminum-plates.png' WHERE "id" = 'aluminum-plates' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/polycarbonate.png' WHERE "id" = 'polycarbonate' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/wood-composites.png' WHERE "id" = 'wood-composites' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/square-tubes.png' WHERE "id" = 'square-tubes' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/shafts.png' WHERE "id" = 'shafts' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/filament.png' WHERE "id" = 'filament' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/rivets.png' WHERE "id" = 'rivets' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/fasteners.png' WHERE "id" = 'fasteners' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/adhesives-tapes.png' WHERE "id" = 'adhesives-tapes' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/rigging-ties.png' WHERE "id" = 'rigging-ties' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/controllers.png' WHERE "id" = 'controllers' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/power-distribution.png' WHERE "id" = 'power-distribution' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/wiring.png' WHERE "id" = 'wiring' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/cnc-bits.png' WHERE "id" = 'cnc-bits' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/lathe-tools.png' WHERE "id" = 'lathe-tools' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/drills-taps.png' WHERE "id" = 'drills-taps' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/hand-tools.png' WHERE "id" = 'hand-tools' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/wheels.png' WHERE "id" = 'wheels' AND ("image" IS NULL OR "image" LIKE '/categories/%');
--> statement-breakpoint
UPDATE "inventory_categories" SET "image" = '/categories/gearboxes.png' WHERE "id" = 'gearboxes' AND ("image" IS NULL OR "image" LIKE '/categories/%');
