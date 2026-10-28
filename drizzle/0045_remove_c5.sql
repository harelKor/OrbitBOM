-- Harel 2026-10-28: location C5 is gone from the workshop. Its items and groups keep everything
-- but the location (the foreign keys set it to null).
DELETE FROM "inventory_locations" WHERE "name" = 'C5';
