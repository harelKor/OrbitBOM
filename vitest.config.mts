import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Database tests share one Postgres, so files run one at a time.
  test: { include: ["src/**/*.test.ts"], fileParallelism: false },
});
