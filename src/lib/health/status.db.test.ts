// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/storage/r2", () => ({ storageConfigured: () => false, listObjects: async () => [] }));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("health status (database): set TEST_DATABASE_URL", () => {});
else
  describe("health status (database)", async () => {
    process.env.DATABASE_URL = url;
    const { readiness, statusChecks, migrationState } = await import("./status");

    it("is ready once every migration in drizzle/ is applied", async () => {
      const m = await migrationState();
      expect(m).toMatchObject({ missing: [], ahead: 0, inSync: true });
      expect(await readiness()).toMatchObject({ ready: true, database: true, missingMigrations: [] });
    });

    it("fails the monitor's check while no backup can be found", async () => {
      const s = await statusChecks();
      expect(s.checks.database.ok).toBe(true);
      expect(s.checks.migrations.ok).toBe(true);
      expect(s.checks.sqlBackup).toMatchObject({ ok: false });
      expect(s.ok).toBe(false);
    });
  });
