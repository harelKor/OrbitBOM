import "server-only";
import { sql } from "drizzle-orm";
import { schema } from "@/db";

// Robots that count: not in the Old folder (what "not archived" used to mean). A null folder passes.
export const robotNotOld = sql<boolean>`${schema.robots.folder} is distinct from 'old'`;
