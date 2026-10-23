// Database schema (plan §3). Fields marked "from Onshape" are refreshed on sync unless their
// name is in parts.overridden_fields.

import { sql } from "drizzle-orm";
import type { Part as DrawingPart } from "../lib/drawing/read";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------- Team ----------

export const members = pgTable("members", {
  id: id(),
  userId: uuid("user_id").notNull().unique(), // auth.users.id
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  onshapeConnected: boolean("onshape_connected").notNull().default(false),
  createdAt: createdAt(),
});

export const invites = pgTable("invites", {
  token: text("token").primaryKey(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  usedBy: uuid("used_by").references(() => members.id, { onDelete: "set null" }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const joinRequestStatus = pgEnum("join_request_status", ["pending", "approved", "denied"]);

export const joinRequests = pgTable("join_requests", {
  userId: uuid("user_id").primaryKey(), // auth.users.id
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  status: joinRequestStatus("status").notNull().default("pending"),
  createdAt: createdAt(),
});

// ---------- Robots and systems ----------

export const robots = pgTable("robots", {
  id: id(),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  code: text("code"),
  deadline: date("deadline"),
  mainAssemblyUrl: text("main_assembly_url"),
  schematicPath: text("schematic_path"),
  thumbnailPath: text("thumbnail_path"),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
});

export const systems = pgTable(
  "systems",
  {
    id: id(),
    robotId: uuid("robot_id")
      .notNull()
      .references(() => robots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    assemblyUrl: text("assembly_url"),
    subassemblyUrls: text("subassembly_urls").array().notNull().default(sql`'{}'::text[]`),
    partstudioUrls: text("partstudio_urls").array().notNull().default(sql`'{}'::text[]`),
    pushNamesToOnshape: boolean("push_names_to_onshape").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    // Last background change check, whether or not anything changed.
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    // Whose Onshape account the background refresh uses: the last member who ran Update BOM here.
    refreshMemberId: uuid("refresh_member_id").references(() => members.id, { onDelete: "set null" }),
    // { [documentId]: microversionId } seen at the last sync; the change check compares to this.
    docMicroversions: jsonb("doc_microversions").$type<Record<string, string>>().notNull().default({}),
    thumbnailPath: text("thumbnail_path"),
    createdAt: createdAt(),
  },
  (t) => [index("systems_robot_idx").on(t.robotId)],
);

// ---------- Parts (one BOM row) ----------

export const classification = pgEnum("classification", ["inhouse", "cots", "external", "undefined"]);
export const priority = pgEnum("priority", ["critical", "high", "normal", "low"]);
export const classSource = pgEnum("class_source", ["rule", "ai", "manual"]);

export type PartGeometry = {
  bbox?: [number, number, number]; // sorted extents, mm (smallest first)
  minDim?: number;
  sizedFrom?: string; // the 3D model file the bbox was measured from
  sizedV?: number; // how it was measured (see SIZED_VERSION in src/lib/review/review.ts)
  bodyType?: string;
  volume?: number;
  mass?: number;
  onshapeMaterial?: string; // Onshape's own material, e.g. "Aluminum - 6061"
  sheetMetal?: { flatPartId: string }; // an Onshape sheet metal part and its flat pattern body
  wallMm?: number; // wall thickness measured from the mesh when the part is a thin wall (flat or bent sheet)
};

// A COTS part's product page; the first is the one its name links to.
export type CotsLink = { url: string; site?: string; priceUsd?: number };

export const parts = pgTable(
  "parts",
  {
    id: id(),
    systemId: uuid("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),

    // Identity (ref §6): Part Studio + partId + Onshape name.
    sourceDid: text("source_did"),
    sourceWid: text("source_wid"),
    sourceEid: text("source_eid"),
    sourceWvm: text("source_wvm"),
    onshapePartId: text("onshape_part_id"),
    onshapeName: text("onshape_name"), // from Onshape

    isManual: boolean("is_manual").notNull().default(false),
    displayName: text("display_name"),
    partNumber: text("part_number"),
    classification: classification("classification").notNull().default("inhouse"),

    description: text("description"), // from Onshape
    material: text("material"), // from Onshape
    inventoryItemId: uuid("inventory_item_id").references(() => inventoryItems.id, {
      onDelete: "set null",
    }),
    quantity: integer("quantity").notNull().default(1), // from Onshape

    // Machine ids from config/machines.ts. From Onshape custom properties.
    preProcess: text("pre_process"),
    process1: text("process1"),
    process2: text("process2"),
    extraProcesses: jsonb("extra_processes").$type<string[]>().notNull().default([]),

    donePreprocess: integer("done_preprocess").notNull().default(0),
    doneProcess1: integer("done_process1").notNull().default(0),
    doneProcess2: integer("done_process2").notNull().default(0),
    designState: text("design_state"),
    // When the part was first made (reached a done status with a machine); it stays in To Fab's
    // Finished section from then on.
    fabFinishedAt: timestamp("fab_finished_at", { withTimezone: true }),

    priority: priority("priority").notNull().default("normal"),
    deadline: date("deadline"),
    designerName: text("designer_name"),
    fabricators: jsonb("fabricators").$type<Record<string, string>>().notNull().default({}),
    note: text("note"),
    estMinutes: integer("est_minutes"),
    actualMinutes: integer("actual_minutes"),

    drawingUrl: text("drawing_url"),
    dxfFace: text("dxf_face"),
    boxQty: integer("box_qty"),

    // COTS: product pages, the average price of one at the quantity needed (US dollars), the COTS
    // page's filter box (config/cots.ts; guessed from the name while null) and how many are in stock.
    cotsLinks: jsonb("cots_links").$type<CotsLink[]>().notNull().default([]),
    unitPrice: real("unit_price"),
    cotsCategory: text("cots_category"),
    stockCount: integer("stock_count").notNull().default(0),
    // Why the Order List sent the part back to Released; cleared when it is sent to order again.
    cotsSentBack: text("cots_sent_back"),

    overriddenFields: text("overridden_fields").array().notNull().default(sql`'{}'::text[]`),

    geometry: jsonb("geometry").$type<PartGeometry>(), // from Onshape
    classGuess: text("class_guess"),
    classSource: classSource("class_source"),

    thumbnailRev: text("thumbnail_rev"),
    removedFromCadAt: timestamp("removed_from_cad_at", { withTimezone: true }),

    lastModifiedAt: timestamp("last_modified_at", { withTimezone: true }).notNull().defaultNow(),
    lastModifiedBy: uuid("last_modified_by").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("parts_system_idx").on(t.systemId),
    index("parts_identity_idx").on(t.sourceDid, t.sourceEid, t.onshapePartId),
  ],
);

// A part's fabrication drawing (plan/auto-drawings.md): the views and sizes read from Onshape's
// exact geometry, and the member's edits to its notes. Laid out with the current BOM row when
// shown, so the BOM block is never stale.
export type DrawingEdits = {
  hidden?: string[]; // note ids
  text?: Record<string, string>;
  moved?: Record<string, [number, number]>; // where a note's text moved to
  arrows?: Record<string, [number, number]>; // where a note's arrow points instead
  added?: { id: string; text: string; at: [number, number]; leader?: [number, number] }[];
};

export const partDrawings = pgTable("part_drawings", {
  partId: uuid("part_id")
    .primaryKey()
    .references(() => parts.id, { onDelete: "cascade" }),
  rev: text("rev"), // the part's thumbnailRev (Onshape microversion) it was read from
  part: jsonb("part").$type<DrawingPart>().notNull(),
  edits: jsonb("edits").$type<DrawingEdits>().notNull().default({}),
  updatedBy: uuid("updated_by").references(() => members.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const partFileType = pgEnum("part_file_type", ["drawing", "gcode", "image", "flattened"]);

export const partFiles = pgTable(
  "part_files",
  {
    id: id(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    type: partFileType("type").notNull(),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    uploadedBy: uuid("uploaded_by").references(() => members.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("part_files_part_idx").on(t.partId)],
);

export const merges = pgTable("merges", {
  id: id(),
  systemId: uuid("system_id")
    .notNull()
    .references(() => systems.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  overrides: jsonb("overrides").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const mergeMembers = pgTable(
  "merge_members",
  {
    mergeId: uuid("merge_id")
      .notNull()
      .references(() => merges.id, { onDelete: "cascade" }),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.mergeId, t.partId] }), uniqueIndex("merge_members_part_uq").on(t.partId)],
);

export const partGroups = pgTable("part_groups", {
  id: id(),
  robotId: uuid("robot_id")
    .notNull()
    .references(() => robots.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  description: text("description"),
  priority: priority("priority").notNull().default("normal"),
  machine: text("machine"), // set on a To Fab batch: the machine (config id) its parts are made on
  madeBy: text("made_by"), // a To Fab batch's member, by name (who created it, changeable)
  createdAt: createdAt(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => partGroups.id, { onDelete: "cascade" }),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    // Identity at the time of grouping, so Why?/Recover can explain and re-link a missing member.
    keySnapshot: jsonb("key_snapshot").$type<Record<string, string | null>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.partId] })],
);

export const groupFiles = pgTable("group_files", {
  id: id(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => partGroups.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  filename: text("filename").notNull(),
  type: text("type").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

// To Review: parts whose material, processes or type were set automatically (by the site's
// rules or by a member's Claude), waiting for their designer to approve. `changes` keeps each
// field's value before and after, so Reject can put it back.
export const partReviews = pgTable("part_reviews", {
  partId: uuid("part_id")
    .primaryKey()
    .references(() => parts.id, { onDelete: "cascade" }),
  source: classSource("source").notNull(),
  reason: text("reason"),
  changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
  // Onshape fields the suggestion marked overridden; Reject un-marks them again.
  addedOverrides: text("added_overrides").array().notNull().default(sql`'{}'::text[]`),
  memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
  // The history batch of the run that suggested it, so To Review can group by run.
  batchId: uuid("batch_id"),
  // The name the AI gave itself (e.g. "Claude Opus 5.5"); null for the site's rules.
  aiName: text("ai_name"),
  createdAt: createdAt(),
});

// AI logs: every change a member's Claude applied through the MCP server, and every Suggest
// setup run. For a change to parts, batch_id points at its part_history rows.
export const aiLogs = pgTable(
  "ai_logs",
  {
    id: id(),
    source: classSource("source").notNull(), // rule = Suggest setup, ai = a member's Claude
    tool: text("tool").notNull(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    batchId: uuid("batch_id"),
    aiName: text("ai_name"),
    summary: text("summary").notNull(),
    parts: integer("parts"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_logs_created_idx").on(t.createdAt)],
);

export const changeVia = pgEnum("change_via", ["ui", "sync", "mcp"]);

// Audit trail and undo: every field change, grouped by batch_id.
export const partHistory = pgTable(
  "part_history",
  {
    id: id(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    via: changeVia("via").notNull(),
    batchId: uuid("batch_id").notNull(),
    // The page visit a UI change was made in, and that page's path: a visit's changes are one
    // "recent action" on the robot dashboard.
    visitId: uuid("visit_id"),
    page: text("page"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("part_history_part_idx").on(t.partId),
    index("part_history_batch_idx").on(t.batchId),
    index("part_history_visit_idx").on(t.visitId),
  ],
);

// Recent actions a member closed with X; they stay hidden for that member only.
export const dismissedActions = pgTable(
  "dismissed_actions",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.visitId] })],
);

// The team's 3D colour for a material category, where it differs from the default in
// src/config/materialColors.ts.
export const materialColors = pgTable("material_colors", {
  category: text("category").primaryKey(),
  color: text("color").notNull(),
  updatedBy: uuid("updated_by").references(() => members.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Inventory ----------

export const inventoryLocations = pgTable("inventory_locations", {
  id: id(),
  name: text("name").notNull().unique(),
});

export const inventoryConditions = pgTable("inventory_conditions", {
  id: id(),
  label: text("label").notNull().unique(),
  color: text("color").notNull(),
});

export const inventoryGroups = pgTable("inventory_groups", {
  id: id(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  templateId: text("template_id"), // FRCBOM part type; unused since categories have fields
  locationId: uuid("location_id").references(() => inventoryLocations.id, { onDelete: "set null" }),
});

// An inventory category's detail field (Harel, 2026-10-23: categories replace part types and
// material). `options` is a chip row (up to 6) or a type-to-filter dropdown; `material` picks from
// the BOM's materials (config/materials.ts groups in `materials`). `name` says how the value goes
// into the item's built name, "{}" standing for the value ("{}T" → "36T"); "" leaves it out.
export type CategoryField = {
  id: string;
  label: string;
  kind: "number" | "text" | "options" | "material";
  options?: string[];
  materials?: string[];
  name?: string;
  hidden?: boolean;
};

// Inventory categories with their own fields, edited on the Inventory settings panel (the one
// exception to "no settings UI"). Seeded from config/inventory.ts the first time they're read.
export const inventoryCategories = pgTable("inventory_categories", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  noun: text("noun").notNull().default(""), // ends the built name: "36T HTD 5mm Pulley"
  position: integer("position").notNull().default(0),
  // Counted in whole sheets and pieces of one (¼ ⅓ ½ ⅔ ¾).
  sheet: boolean("sheet").notNull().default(false),
  image: text("image"), // R2 key of the category's picture (the Inventory home box)
  defaultLocationId: uuid("default_location_id").references(() => inventoryLocations.id, { onDelete: "set null" }),
  fields: jsonb("fields").$type<CategoryField[]>().notNull().default([]),
});

export const inventoryItems = pgTable("inventory_items", {
  id: id(),
  name: text("name").notNull(),
  groupId: uuid("group_id").references(() => inventoryGroups.id, { onDelete: "set null" }),
  category: text("category"), // inventory_categories id; guessed from the name while null
  // The category's field values by field id.
  specs: jsonb("specs").$type<Record<string, string>>().notNull().default({}),
  // Product pages, like a COTS part's; the first is the one the name opens.
  cotsLinks: jsonb("cots_links").$type<CotsLink[]>().notNull().default([]),
  conditionId: uuid("condition_id").references(() => inventoryConditions.id, { onDelete: "set null" }),
  locationId: uuid("location_id").references(() => inventoryLocations.id, { onDelete: "set null" }),
  // Whole units; an item in a sheet category also holds pieces, in twelfths of a sheet.
  inStock: doublePrecision("in_stock").notNull().default(0),
  imagePath: text("image_path"),
  price: real("price"),
  // The Onshape library part (did:eid:partId) it was first linked to: new BOM parts with the same
  // key are linked on sync. Other names the item was linked under, for match suggestions.
  onshapeKey: text("onshape_key"),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
});

export const stockReason = pgEnum("stock_reason", ["received", "used", "broke", "counted", "returned"]);

// Every change to an item's stock: who, why, and for which part. in_stock is their running total,
// updated in the same transaction; batch_id lets undo_batch reverse an MCP change.
export const inventoryMoves = pgTable(
  "inventory_moves",
  {
    id: id(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    delta: doublePrecision("delta").notNull(),
    reason: stockReason("reason").notNull(),
    partId: uuid("part_id").references(() => parts.id, { onDelete: "set null" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    via: changeVia("via").notNull(),
    aiName: text("ai_name"),
    batchId: uuid("batch_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_moves_item_idx").on(t.itemId, t.at), index("inventory_moves_batch_idx").on(t.batchId)],
);

// ---------- Onshape ----------

export const onshapeTokens = pgTable("onshape_tokens", {
  memberId: uuid("member_id")
    .primaryKey()
    .references(() => members.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  callsToday: integer("calls_today").notNull().default(0),
  callsDay: date("calls_day"),
});

export const onshapeCache = pgTable("onshape_cache", {
  key: text("key").primaryKey(),
  microversion: text("microversion"),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncJobState = pgEnum("sync_job_state", ["queued", "running", "done", "failed"]);

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: id(),
    systemId: uuid("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    state: syncJobState("state").notNull().default("queued"),
    step: text("step"),
    diff: jsonb("diff"),
    error: text("error"),
    byMember: uuid("by_member").references(() => members.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("sync_jobs_system_idx").on(t.systemId)],
);

// One-time sign-in codes for the panel inside Onshape. Google sign-in can't run in Onshape's
// iframe, so the panel opens a popup where the member approves its code, then collects the code.
export const panelLogins = pgTable("panel_logins", {
  codeHash: text("code_hash").primaryKey(),
  memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

// ---------- MCP ----------

// Personal tokens members paste into their own Claude to use the MCP server (plan §6).
export const mcpTokens = pgTable("mcp_tokens", {
  id: id(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: createdAt(),
});
