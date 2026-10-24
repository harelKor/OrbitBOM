// R2 storage limits (plan/system-versioning.md §5). The free tier holds 10 GB. Above WARN the
// dashboard shows the storage box; above CLEAN_UP the nightly clean-up frees space down to
// CLEAN_UP_TO. Sizes in bytes.
const GB = 1024 ** 3;
export const STORAGE_LIMIT = 10 * GB;
export const STORAGE_WARN = 6 * GB;
export const STORAGE_CLEAN_UP = 8 * GB;
export const STORAGE_CLEAN_UP_TO = 7 * GB;
// The newest versions of each system whose 3D previews clean-up never deletes.
export const KEEP_PREVIEW_VERSIONS = 3;
// Supabase Free's database size.
export const DATABASE_LIMIT = 500 * 1024 ** 2;
