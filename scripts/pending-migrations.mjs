// Prints the tags of the migrations in drizzle/ that the database at DIRECT_URL hasn't applied
// (space-separated; nothing when it's up to date). The Deploy workflow runs it before and after
// `drizzle-kit migrate`. drizzle stores each migration's journal `when` as created_at.
import { createRequire } from "node:module";
import pg from "pg";

const journal = createRequire(import.meta.url)("../drizzle/meta/_journal.json");
const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();
// No drizzle schema yet (a brand-new database): everything is pending.
const { rows } = await client.query("select created_at from drizzle.__drizzle_migrations").catch(() => ({ rows: [] }));
await client.end();
const applied = new Set(rows.map((r) => Number(r.created_at)));
console.log(journal.entries.filter((e) => !applied.has(e.when)).map((e) => e.tag).join(" "));
