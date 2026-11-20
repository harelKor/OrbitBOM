-- Computers & Devices' picture without its grey backdrop, cropped like the others (Harel,
-- 2026-11-20). A new file name, so browsers don't keep showing the old one; a picture chosen on
-- /settings since is left alone.
UPDATE "inventory_categories" SET "image" = '/categories/computers-devices-2.png' WHERE "id" = 'computers-devices' AND "image" = '/categories/computers-devices.png';
