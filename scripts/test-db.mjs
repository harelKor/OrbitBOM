// Runs the tests with the database ones included, as CI does: starts the Postgres in
// docker-compose.test.yml (Docker Desktop must be running), applies the migrations, then runs
// vitest. Extra arguments go to vitest: `npm run test:db -- src/lib/versions`.
// `npm run test:db -- --down` stops the database instead.
import { spawnSync } from "node:child_process";

const URL = "postgres://postgres:postgres@localhost:54329/postgres";
const compose = ["compose", "-f", "docker-compose.test.yml"];
const args = process.argv.slice(2);

function run(cmd, cmdArgs, env = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (args.includes("--down")) {
  run("docker", [...compose, "down"]);
  process.exit(0);
}
run("docker", [...compose, "up", "-d", "--wait"]);
run("npx", ["drizzle-kit", "migrate"], { DIRECT_URL: URL });
run("npx", ["vitest", "run", ...args], { TEST_DATABASE_URL: URL });
