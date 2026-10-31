// Database schema (plan §3). Fields marked "from Onshape" are refreshed on sync unless their
// name is in parts.overridden_fields.

import { sql } from "drizzle-orm";
import type { Part as DrawingPart } from "../lib/drawing/read";
import type { PieceRow } from "../lib/inventory/stock";
import {
  bigint,
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
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------- Team ----------

export const memberTeam = pgEnum("member_team", ["build", "cad"]);

export const members = pgTable("members", {
  id: id(),
  userId: uuid("user_id").notNull().unique(), // auth.users.id
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  onshapeConnected: boolean("onshape_connected").notNull().default(false),
  // Build Team lands on To Fab, CAD Team on their subsystem's page. Null: the home tiles.
  team: memberTeam("team"),
  // CAD Team only: the robot system the member designs.
  systemId: uuid("system_id").references((): AnyPgColumn => systems.id, { onDelete: "set null" }),
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
  // The Onshape document where this robot's Fab batch layout assemblies are made (Harel,
  // 2026-10-31), with its default workspace. Unset: the batch's system document.
  layoutsDocumentUrl: text("layouts_document_url"),
  layoutsDocumentId: text("layouts_document_id"),
  layoutsWorkspaceId: text("layouts_workspace_id"),
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
    // Version control (plan/system-versioning.md): the committed version the system is on.
    currentVersionId: uuid("current_version_id"),
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
    // A COTS card added on the COTS page may belong to no system: then robotId says its robot,
    // or neither is set and it is in the COTS page's General section.
    systemId: uuid("system_id").references(() => systems.id, { onDelete: "cascade" }),
    robotId: uuid("robot_id").references(() => robots.id, { onDelete: "cascade" }),

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
    // How many are post-processed, counted on To Fab's To Post Process (it isn't a process slot,
    // so it doesn't move the status).
    postDone: integer("post_done").notNull().default(0),
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
    // page's filter box and how many are in stock.
    cotsLinks: jsonb("cots_links").$type<CotsLink[]>().notNull().default([]),
    unitPrice: real("unit_price"),
    // An inventory category id (inventory_categories); a linked item's category wins over it.
    cotsCategory: text("cots_category"),
    stockCount: integer("stock_count").notNull().default(0),
    // Why the Order List sent the part back to Released; cleared when it is sent to order again.
    cotsSentBack: text("cots_sent_back"),
    // When the COTS part reached In Stock (null while it isn't), and when someone cleared it from
    // the COTS page's In Stock sections (they also drop it a week after it arrived).
    cotsInStockAt: timestamp("cots_in_stock_at", { withTimezone: true }),
    cotsClearedAt: timestamp("cots_cleared_at", { withTimezone: true }),
    // A COTS card Inventory sent to Released to refill the shelf (its item was short): it orders
    // stock, it isn't a part a robot uses, so it never counts in the robots' need.
    restock: boolean("restock").notNull().default(false),

    overriddenFields: text("overridden_fields").array().notNull().default(sql`'{}'::text[]`),

    geometry: jsonb("geometry").$type<PartGeometry>(), // from Onshape
    classGuess: text("class_guess"),
    classSource: classSource("class_source"),

    thumbnailRev: text("thumbnail_rev"),
    // The thumbnail's fingerprint (src/lib/images/dhash.ts), so auto-link can spot the same part.
    thumbHash: text("thumb_hash"),
    // The part's shape fingerprint as of its last commit (src/lib/versions/shape.ts), and the
    // version row (its committed state) the part points at; see system_versions below.
    shapeSig: text("shape_sig"),
    versionRowId: uuid("version_row_id"),
    // The state the part was released to fab at (plan/fab-version-lock.md): To Fab shows it, so a
    // later commit doesn't swap the part under the shop. Set on Released / Reproduction /
    // Secondary Production; null for parts never released since.
    releasedVersionId: uuid("released_version_id").references((): AnyPgColumn => systemVersions.id, { onDelete: "set null" }),
    releasedRowId: uuid("released_row_id"),
    releasedSnapshot: jsonb("released_snapshot").$type<ReleasedSnapshot>(),
    removedFromCadAt: timestamp("removed_from_cad_at", { withTimezone: true }),

    lastModifiedAt: timestamp("last_modified_at", { withTimezone: true }).notNull().defaultNow(),
    lastModifiedBy: uuid("last_modified_by").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("parts_system_idx").on(t.systemId),
    index("parts_robot_idx").on(t.robotId),
    index("parts_identity_idx").on(t.sourceDid, t.sourceEid, t.onshapePartId),
    index("parts_inventory_item_idx").on(t.inventoryItemId),
  ],
);

// What To Fab shows of a released part: its state when it was released.
export type ReleasedSnapshot = {
  name: string | null;
  quantity: number;
  material: string | null;
  thumbnailRev: string | null;
  shapeSig: string | null;
  studio: string | null; // its frozen Part Studio (src/lib/versions/studio.ts), for STEP and 3D
  onshapePartId: string | null;
  flatPartId: string | null; // sheet metal's flat pattern
  versionLabel: string | null; // "V70"
  versionName: string | null;
  status: string;
  at: string;
};

// A part's fabrication drawing (plan/auto-drawings.md): the views and sizes read from Onshape's
// exact geometry, and the member's edits to its notes. Laid out with the current BOM row when
// shown, so the BOM block is never stale.
export type DrawingEdits = {
  hidden?: string[]; // note ids
  text?: Record<string, string>;
  moved?: Record<string, [number, number]>; // where a note's text moved to
  arrows?: Record<string, [number, number]>; // where a note's arrow points instead
  // A fit note can name the BOM part or inventory item it fits, so the drawing opens its window.
  added?: { id: string; text: string; at: [number, number]; leader?: [number, number]; fitPartId?: string; fitInventoryItemId?: string; fitTargetName?: string }[];
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
  // The Auto Layout window's last state (positions, turns, gap, margin, sheet), restored on open,
  // and the "Batch - <name>" assembly it made in Onshape (src/lib/fab/onshapeLayout.ts). Saving
  // one half merges into the column (jsonb ||), never wiping the other.
  layoutData: jsonb("layout_data").$type<LayoutData>(),
  createdAt: createdAt(),
});

// A copy's place on the sheet: its flat-frame origin (mm) and turn about Z (degrees, any angle).
export type LayoutPlacement = { partId: string; copy: number; x: number; y: number; rotation: number };
// `rev` names the layout last pushed, for the cached batch STEP.
export type OnshapeLayoutRef = { baseUrl: string; did: string; wid: string; eid: string; url: string; rev: string; createdAt: string };
export type LayoutData = {
  gap?: number;
  margin?: number;
  sheetKey?: string; // "auto", a stock piece size ("f6", "p500x450"), or "custom:<width>"
  placements?: LayoutPlacement[];
  onshape?: OnshapeLayoutRef;
};

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
  (t) => [primaryKey({ columns: [t.groupId, t.partId] }), index("group_members_part_idx").on(t.partId)],
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
export const partReviews = pgTable(
  "part_reviews",
  {
    partId: uuid("part_id")
      .primaryKey()
      .references(() => parts.id, { onDelete: "cascade" }),
    source: classSource("source").notNull(),
    reason: text("reason"),
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    // Suggested but not applied yet (an inventory link waits for Approve, Harel 2026-10-23):
    // Approve applies them, Reject drops them.
    pending: jsonb("pending").$type<Record<string, unknown>>().notNull().default({}),
    // Onshape fields the suggestion marked overridden; Reject un-marks them again.
    addedOverrides: text("added_overrides").array().notNull().default(sql`'{}'::text[]`),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    // The history batch of the run that suggested it, so To Review can group by run.
    batchId: uuid("batch_id"),
    // The name the AI gave itself (e.g. "Claude Opus 5.5"); null for the site's rules.
    aiName: text("ai_name"),
    createdAt: createdAt(),
  },
  (t) => [index("part_reviews_batch_idx").on(t.batchId)],
);

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
    // When a member pressed Revert change on the AI logs page.
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("ai_logs_created_idx").on(t.createdAt), index("ai_logs_batch_idx").on(t.batchId)],
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
    // A part's history newest first, and Recent actions / Undo, which look at the last days only.
    index("part_history_part_at_idx").on(t.partId, t.at),
    index("part_history_at_idx").on(t.at),
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

// The team's BOM and inventory materials, one row per material category in list order. Seeded
// from src/config/materials.ts the first time they're read; edited on the Settings page.
export const materialGroups = pgTable("material_groups", {
  name: text("name").primaryKey(),
  position: integer("position").notNull().default(0),
  materials: jsonb("materials").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- System versions (plan/system-versioning.md) ----------

// Changes from Onshape reach a system's BOM only when a member commits them. Each check keeps
// what it found in the system's one draft; a commit turns the draft into the next version.
export const versionState = pgEnum("version_state", ["draft", "committed"]);
export const partChange = pgEnum("part_change", ["baseline", "added", "modified", "removed"]);

// One part's state in a version: its Onshape reference and the fields Onshape fills in.
export type PartSnapshot = {
  sourceDid: string | null;
  sourceWid: string | null;
  sourceWvm: string | null;
  sourceEid: string | null;
  onshapePartId: string | null;
  onshapeName: string | null;
  partNumber: string | null;
  description: string | null;
  material: string | null;
  onshapeMaterial: string | null;
  quantity: number;
  preProcess: string | null;
  process1: string | null;
  process2: string | null;
  sig: string | null; // shape fingerprint (src/lib/versions/shape.ts)
  studio?: string | null; // its Part Studio, frozen (src/lib/versions/studio.ts), for the 3D preview
};

// A change a check found (or a commit made): what the Commit and Versions windows list.
export type VersionChange = {
  key: string; // did:eid:partId:name of the new state (the old one for a removed part)
  partId: string | null; // null for a part Onshape added
  change: "added" | "modified" | "removed";
  name: string;
  partNumber: string | null;
  fields: Record<string, { from: unknown; to: unknown }>; // Onshape fields that changed
  geometry: boolean; // the part's shape changed in Onshape
  note?: string; // "Back in CAD", "Re-linked by name"
};

// The Onshape state a version comes from: the Manufacture document's microversion and, per
// document inserted by version, that version ("V70"); `from` is what the parts used before.
// `parts`: how many of the BOM's parts come from that document; `main`: the document most of
// them come from, which names the version (label.ts). Versions read before these were kept lack both.
type DocVersions = Record<string, { versionId: string; name: string; parts?: number; main?: boolean }>;
export type VersionRef = { mv: string | null; did: string; sources?: DocVersions; from?: DocVersions };

export const systemVersions = pgTable(
  "system_versions",
  {
    id: id(),
    systemId: uuid("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    state: versionState("state").notNull(),
    seq: integer("seq"), // 0 = baseline, then 1, 2, 3…; null while a draft
    name: text("name"),
    onshapeRef: jsonb("onshape_ref").$type<VersionRef>(),
    changes: jsonb("changes").$type<VersionChange[]>().notNull().default([]),
    // A draft's BOM rows and part microversions, applied as they are on commit.
    rows: jsonb("rows"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    detectedBy: uuid("detected_by").references(() => members.id, { onDelete: "set null" }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    committedBy: uuid("committed_by").references(() => members.id, { onDelete: "set null" }),
    // A draft some of whose parts were committed one at a time: the version they went into. The
    // draft's other parts are Outdated until they are committed too.
    partialVersionId: uuid("partial_version_id"),
  },
  (t) => [
    uniqueIndex("system_versions_seq_uq").on(t.systemId, t.seq),
    uniqueIndex("system_versions_draft_uq").on(t.systemId).where(sql`${t.state} = 'draft'`),
  ],
);

// A part's state in each version that changed it (sparse); parts.version_row_id points at the
// state the part is on.
export const partVersions = pgTable(
  "part_versions",
  {
    id: id(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => systemVersions.id, { onDelete: "cascade" }),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    change: partChange("change").notNull(),
    snapshot: jsonb("snapshot").$type<PartSnapshot>().notNull(),
    meshKey: text("mesh_key"), // the R2 file with this state's 3D preview
  },
  (t) => [index("part_versions_part_idx").on(t.partId, t.versionId), index("part_versions_version_idx").on(t.versionId)],
);

// Every time a part was released to fab (Released, Reproduction, Secondary Production) and the
// version it was on, so its version history can tag those versions.
export const partReleases = pgTable(
  "part_releases",
  {
    id: id(),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => systemVersions.id, { onDelete: "set null" }),
    rowId: uuid("row_id"),
    status: text("status").notNull(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    batchId: uuid("batch_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("part_releases_part_idx").on(t.partId)],
);

// What is stored in R2, key by key (plan/system-versioning.md §5): putObject and deleteObject
// keep it current and the nightly recount fills in what the browser uploaded directly. The
// storage window reads its sums, so it costs no R2 calls.
export const storedFiles = pgTable(
  "stored_files",
  {
    key: text("key").primaryKey(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    kind: text("kind").notNull(), // studio | part | preview | thumb | file | image | backup | other
    // A 3D preview's version, so the storage window can count and free a version's previews.
    versionId: uuid("version_id").references(() => systemVersions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stored_files_version_idx").on(t.versionId)],
);

// ---------- Inventory ----------

// map_x / map_y place the location's pin on the workshop map (config/workshopMap.ts units);
// null keeps it off the map.
export const inventoryLocations = pgTable("inventory_locations", {
  id: id(),
  name: text("name").notNull().unique(),
  mapX: real("map_x"),
  mapY: real("map_y"),
});

export const inventoryConditions = pgTable("inventory_conditions", {
  id: id(),
  label: text("label").notNull().unique(),
  color: text("color").notNull(),
});

// The team's base materials (Aluminum, 6061-T6, Polycarbonate...), edited on the Settings page.
// Inventory "material" fields offer them (Harel, 2026-10-30); seeded from BASE_MATERIALS in
// src/config/materials.ts.
export const baseMaterials = pgTable("base_materials", {
  id: id(),
  name: text("name").notNull().unique(),
  position: integer("position").notNull().default(0),
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
  // Old material fields named groups of config/materials.ts MATERIALS; since 2026-10-30 a material
  // field offers the team's base materials (`options` narrows them).
  materials?: string[];
  // A material field's choices, filled in when categories are read (never stored).
  materialChoices?: string[];
  name?: string;
  hidden?: boolean;
  // Only for these values of the category's first field (its sub-type); see activeFields.
  when?: string | string[];
};

// Inventory categories with their own fields, edited on the Settings page. Seeded from config/inventory.ts the first time they're read.
export const inventoryCategories = pgTable("inventory_categories", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  noun: text("noun").notNull().default(""), // ends the built name: "36T HTD 5mm Pulley"
  position: integer("position").notNull().default(0),
  group: text("group").notNull().default("general"), // CATEGORY_GROUPS in config/inventory.ts
  // Counted in whole sheets and pieces of one (¼ ⅓ ½ ⅔ ¾).
  sheet: boolean("sheet").notNull().default(false),
  image: text("image"), // the category's picture (its box): a public/categories/ path or an R2 key
  defaultLocationId: uuid("default_location_id").references(() => inventoryLocations.id, { onDelete: "set null" }),
  fields: jsonb("fields").$type<CategoryField[]>().notNull().default([]),
  // The AI run that added the category (add_inventory_category), so its Revert removes it.
  batchId: uuid("batch_id"),
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
  // A fraction item's piece sizes and counts ({ size: "f6" | "m450" | "p500x450", count }[]); they
  // sum to in_stock. Older rows hold {} or a { twelfths: count } map (lib/inventory/stock.ts).
  pieces: jsonb("pieces").$type<PieceRow[] | Record<string, number>>().notNull().default({}),
  // How many the team wants on the shelf for the season, whatever the robots use (Harel,
  // 2026-10-27). Null: no season need. Sheet items take pieces like in_stock.
  seasonNeed: doublePrecision("season_need"),
  // A remark for whoever takes or orders it, shown as a cloud on the card (Harel, 2026-10-28).
  note: text("note"),
  // "2026": still from last season's list; "2027": checked for the 2027 season. Only the card's,
  // table's and item window's tag flips it (Harel, 2026-10-30). New items start checked.
  seasonTag: text("season_tag").$type<"2026" | "2027">().notNull().default("2027"),
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
    // The page visit a change on the site was made in, and its path (Inventory's Recent actions).
    visitId: uuid("visit_id"),
    page: text("page"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_moves_item_idx").on(t.itemId, t.at), index("inventory_moves_batch_idx").on(t.batchId), index("inventory_moves_visit_idx").on(t.visitId)],
);

// A suggested inventory link someone rejected: auto-link doesn't suggest that pair again.
export const inventoryLinkRejections = pgTable(
  "inventory_link_rejections",
  {
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.partId, t.itemId] })],
);

// Every change to an item other than its stock: created, and each edited field (name, category,
// specs, location, condition, links, price, photo) with its old and new value. The item window's
// history shows these with the stock moves.
export const inventoryItemHistory = pgTable(
  "inventory_item_history",
  {
    id: id(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    field: text("field").notNull(), // "created", or the column's name in camelCase
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    via: changeVia("via").notNull(),
    aiName: text("ai_name"),
    // The MCP run that made the change, for AI logs and their Revert.
    batchId: uuid("batch_id"),
    visitId: uuid("visit_id"),
    page: text("page"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_item_history_item_idx").on(t.itemId, t.at),
    index("inventory_item_history_visit_idx").on(t.visitId),
    index("inventory_item_history_batch_idx").on(t.batchId),
  ],
);

// To Review's Inventory section (Harel, 2026-10-27): a member's Claude editing an existing item
// (applied at once, Reject puts the old values back) or adding a category (Reject removes it).
// New items don't wait here; they show in AI logs.
export const inventoryReviews = pgTable("inventory_reviews", {
  id: id(),
  kind: text("kind").$type<"item" | "category">().notNull(),
  itemId: uuid("item_id")
    .unique()
    .references(() => inventoryItems.id, { onDelete: "cascade" }),
  categoryId: text("category_id")
    .unique()
    .references(() => inventoryCategories.id, { onDelete: "cascade" }),
  // An item's changed fields with their value before and after (inventory_item_history's names).
  changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>().notNull().default({}),
  reason: text("reason"),
  memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
  batchId: uuid("batch_id"),
  aiName: text("ai_name"),
  createdAt: createdAt(),
});

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
