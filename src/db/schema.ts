// Database schema (plan §3). Fields marked "from Onshape" are refreshed on sync unless their
// name is in parts.overridden_fields.

import { sql } from "drizzle-orm";
import type { Part as DrawingPart } from "../lib/drawing/read";
import type { PieceRow } from "../lib/inventory/stock";
import type { Shape } from "../lib/review/shape";
import type { ViewState } from "../components/viewer/viewState";
import type { CheckLimits, CheckResults } from "../lib/check/types";
import type { Anchor } from "../lib/reviews/anchor";
import type { AddedProcess } from "../lib/status";
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
  smallint,
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
  // The member's team (sets their mode). Every team opens the app on the home tiles.
  team: memberTeam("team"),
  // Mentors approve or reject ticked-off CAD Review comments (set by an admin on /members).
  isMentor: boolean("is_mentor").notNull().default(false),
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

// A Basepart's chosen sketches, the robot's or system's "Geometry" (Harel, 2026-11-12): Onshape's
// sketch feature id and its name then.
export type GeometrySketch = { id: string; name: string };
export type BasepartKind = "partstudio" | "assembly";
// The two 3D models of a robot (Harel, 2026-11-12): its Basepart and its Final.
export type ModelKind = "basepart" | "final";
// The Basepart link a robot and a system both have: the Part Studio or assembly it is now, and the
// Part Studio its Geometry sketches come from (kept when the Part Studio is replaced by the
// assembly, so the sketches stay).
const basepartColumns = () => ({
  basepartUrl: text("basepart_url"),
  basepartKind: text("basepart_kind").$type<BasepartKind>(),
  basepartStudioUrl: text("basepart_studio_url"),
  basepartSketches: jsonb("basepart_sketches").$type<GeometrySketch[]>().notNull().default([]),
  // Where the Basepart 3D model reads it: the state its last Update was committed at (an Onshape
  // version or a microversion; Harel, 2026-11-13). Null: its workspace, as before.
  basepartModelRef: jsonb("basepart_model_ref").$type<{ wvm: "v" | "m"; wvmid: string }>(),
});

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
  // The Raw stock planner's chosen piece size per stock group (Harel, 2026-11-07): group key (an
  // inventory item id or "auto:…") → a piece size key ("p500x900", "m1000").
  rawStockSizes: jsonb("raw_stock_sizes").$type<Record<string, string>>().notNull().default({}),
  // The robot's Basepart (Harel, 2026-11-12): its main Part Studio, later replaced by the robot
  // Basepart assembly in the same document. 3D only; `main_assembly_url` is the robot's Final.
  ...basepartColumns(),
  // Design check (plan/design-check.md): the season's weight and size limits, the systems left
  // out (bumpers) and each system's weight budget. Set on the CAD page in Edit mode.
  checkLimits: jsonb("check_limits").$type<CheckLimits>().notNull().default({}),
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
    // The system follows its assembly's Onshape versions, not its workspace: change detection
    // reads the document's newest version, so students' edits between versions cost nothing and
    // no separate Manufacture document is needed (Harel, 2026-11-08).
    followVersions: boolean("follow_versions").notNull().default(false),
    // The newest Onshape version the last check saw, so the next one stops after 1 call.
    followedVersionId: text("followed_version_id"),
    // Where the 3D model reads this system's assembly (Harel, 2026-11-11): the state the last
    // Update CAD, or Update BOM with "Update 3D views" ticked, was made from: an Onshape version
    // or a microversion, which never change, so a rebuild reads nothing again for it. Null: the
    // assembly's own link (its workspace), as before.
    modelRef: jsonb("model_ref").$type<{ wvm: "v" | "m"; wvmid: string }>(),
    // Where the system's made parts wait, by status (Harel, 2026-11-14): "Ready for QA" parts in
    // one drawer, "In Stock" in another. Status name → inventory_locations id (a zone or a spot).
    drawers: jsonb("drawers").$type<Record<string, string>>().notNull().default({}),
    // The system's Basepart (Harel, 2026-11-12): designed first in a Part Studio, then replaced by
    // the Basepart assembly in the same document. 3D views and comments only: the BOM is read
    // from `assembly_url`, the system's Final assembly.
    ...basepartColumns(),
    createdAt: createdAt(),
  },
  (t) => [index("systems_robot_idx").on(t.robotId)],
);

// Update CAD in the Onshape panel (Harel, 2026-11-11): each one is a node of the CAD version
// tree. With a new Onshape version (`onshapeVersionId`) it is that version; without one it is a
// sub-version "V12 v1" of `parentVersionId`, pinned to the workspace's microversion. `model`: the
// Final's or the Basepart's (Harel, 2026-11-13), each with its own tree; a robot's own Basepart
// has `robotId` and no system.
export const cadUpdates = pgTable(
  "cad_updates",
  {
    id: id(),
    systemId: uuid("system_id").references(() => systems.id, { onDelete: "cascade" }),
    robotId: uuid("robot_id").references(() => robots.id, { onDelete: "cascade" }),
    model: text("model").$type<ModelKind>().notNull().default("final"),
    did: text("did").notNull(),
    microversion: text("microversion").notNull(),
    onshapeVersionId: text("onshape_version_id"),
    parentVersionId: text("parent_version_id"),
    label: text("label").notNull(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("cad_updates_system_idx").on(t.systemId, t.createdAt), index("cad_updates_robot_idx").on(t.robotId, t.createdAt)],
);

// Every version's 3D model (plan/cad-versions.md, Harel 2026-11-17): one group's plan (its Part
// Studio files in R2 and where each part sits) at a fixed Onshape state, so an old version is
// drawn, compared and its Commit window shown without Onshape. `key`: model kind, document,
// element and the version or microversion (snapshots.ts). `complete`: every file is in R2.
export const modelSnapshots = pgTable(
  "model_snapshots",
  {
    key: text("key").primaryKey(),
    robotId: uuid("robot_id")
      .notNull()
      .references(() => robots.id, { onDelete: "cascade" }),
    plan: jsonb("plan").notNull(),
    complete: boolean("complete").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("model_snapshots_robot_idx").on(t.robotId)],
);

// Onshape versions deleted from OrbitParts (Onshape can't delete versions; Harel, 2026-11-17): left
// out of every version tree of that document.
export const deletedVersions = pgTable(
  "deleted_versions",
  {
    id: id(),
    did: text("did").notNull(),
    versionId: text("version_id").notNull(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("deleted_versions_uq").on(t.did, t.versionId)],
);

// The whole robot's own versions (Create version, Harel 2026-11-17): "R3" records which version
// each system was on at that moment, so the robot is drawn as it was then.
export type RobotVersionSystem = { systemId: string; name: string; kind: ModelKind; ref: { wvm: "v" | "m"; wvmid: string } | null; label: string | null };
export const robotVersions = pgTable(
  "robot_versions",
  {
    id: id(),
    robotId: uuid("robot_id")
      .notNull()
      .references(() => robots.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    note: text("note"),
    systems: jsonb("systems").$type<RobotVersionSystem[]>().notNull().default([]),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("robot_versions_seq_uq").on(t.robotId, t.seq)],
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
  shape?: Shape; // the stock shape read from the mesh (src/lib/review/shape.ts)
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

    // Machine ids from config/machines.ts (process1 may be "cots", bought). From Onshape custom
    // properties. pre_process, process2, done_preprocess, done_process2 and extra_processes are no
    // longer read (Harel, 2026-11-20: no Pre-process; Process 2 became the first added process):
    // to drop in a later push.
    preProcess: text("pre_process"),
    process1: text("process1"),
    process2: text("process2"),
    extraProcesses: jsonb("extra_processes").$type<string[]>().notNull().default([]),
    // The processes after Process 1, in order, each with its machine, done counter and whether QA
    // is needed before it starts (src/lib/status.ts). Onshape's Process 2 fills the first one.
    addedProcesses: jsonb("added_processes").$type<AddedProcess[]>().notNull().default([]),
    // "+" finished a step that leads to QA and the member kept the part at its process.
    qaHeld: boolean("qa_held").notNull().default(false),
    // A bought part arrived from the Order List and waits for CAD's QA.
    cotsQa: boolean("cots_qa").notNull().default(false),

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
    // When the part last arrived in a page's list (src/lib/seen.ts): Shop Fab's Released, In process
    // or Post Processing, a printer's or factory's Released, COTS Released or Order List. Members
    // who haven't opened that page since see it glow (Harel, 2026-11-05).
    stageAt: timestamp("stage_at", { withTimezone: true }),

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
    // When the order is due to arrive (Order List: the item window and its cart; Harel, 2026-11-05).
    cotsDeliveryDate: date("cots_delivery_date"),
    // The Released / Order List pages only (Harel, 2026-11-20): the name the order shows (else the
    // linked item's name, else the part's), and the parts merged into one order line there (tubes
    // cut to several lengths, bought as one stock).
    orderName: text("order_name"),
    orderMerge: uuid("order_merge"),
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
    // stage_at: the layout's arrivals (data/seen.ts). released_version_id: deleting a BOM version
    // sets it to null here, which scanned every part.
    index("parts_stage_at_idx").on(t.stageAt),
    index("parts_released_version_idx").on(t.releasedVersionId),
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
// A point on a drawing's view (src/lib/drawing/types.ts Ref): view key, view mm, and optionally
// the hole whose edge it sits on, so it follows the part when the drawing is made again.
export type DrawingRef = { v: string; p: [number, number]; hole?: string; ang?: number };
export type DrawingEdits = {
  hidden?: string[]; // note and dimension ids
  text?: Record<string, string>; // note and dimension ids → the words shown instead
  // Older saves: where a note's text moved to and where its arrow pointed, on the sheet. New
  // edits use `shift` and `tips`, which survive the drawing being laid out at another scale.
  moved?: Record<string, [number, number]>;
  arrows?: Record<string, [number, number]>;
  shift?: Record<string, [number, number]>; // sheet mm an automatic note's text, or a dimension's line, moved by
  tips?: Record<string, DrawingRef>; // where an automatic note's arrow points instead
  // A fit note can name the BOM part or inventory item it fits, so the drawing opens its window.
  // `ref` + `off`: the arrow's tip on the part and the text's place from it (`at` and `leader`
  // stay as they were drawn, for when the view is gone). `dia`: a diameter dimension, reading
  // the hole's Ø unless `text` says otherwise.
  added?: {
    id: string;
    text: string;
    at: [number, number];
    leader?: [number, number];
    ref?: DrawingRef;
    off?: [number, number];
    dia?: boolean;
    fitPartId?: string;
    fitInventoryItemId?: string;
    fitTargetName?: string;
  }[];
  // Dimensions placed with the editor's Dimension tool: between two points of one view, its line
  // `off` sheet mm beyond the outer one (aligned, "a": `off` mm beside the a→b line), its text
  // slid `tx` mm along the line, reading the measured length unless `text` is set.
  dims?: { id: string; a: DrawingRef; b: DrawingRef; dir: "h" | "v" | "a"; off: number; tx?: number; text?: string }[];
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

export const merges = pgTable(
  "merges",
  {
    id: id(),
    systemId: uuid("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    overrides: jsonb("overrides").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("merges_system_idx").on(t.systemId)],
);

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

export const partGroups = pgTable(
  "part_groups",
  {
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
  },
  (t) => [index("part_groups_robot_idx").on(t.robotId)],
);

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
  // The face each part lies on, chosen in the layout window's 3D preview: part id → that face's
  // outward normal in Part Studio axes. A part not listed lies on the side with more flat area.
  faces?: Record<string, [number, number, number]>;
  // Sheet metal parts' flat STEPs imported into the layout's document, since Onshape won't place a
  // flat pattern in an assembly (src/lib/fab/onshapeLayout.ts): "<document id>|<part id>" → the imported part, and
  // the flat pattern (`source`: revision, Part Studio, flat body) it was made from.
  flatImports?: Record<string, { did: string; eid: string; partId: string; source: string }>;
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

// An Order List cart: COTS parts from one vendor, bought together. Its cart button opens a cart on
// the vendor's site with them in it (Harel, 2026-11-04). Not per robot, since the Order List isn't.
export const cotsCarts = pgTable("cots_carts", {
  id: id(),
  vendor: text("vendor").notNull(), // the parts' vendor as the Order List names it (siteOf their first link)
  createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// A part is in one cart at most.
export const cotsCartMembers = pgTable(
  "cots_cart_members",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => cotsCarts.id, { onDelete: "cascade" }),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.cartId, t.partId] }), uniqueIndex("cots_cart_members_part_uq").on(t.partId)],
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
  preProcess?: string | null; // before 2026-11-20: Pre-process is gone, no longer compared
  process1: string | null;
  process2: string | null; // Onshape's Process 2: the first added process
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
  collision?: boolean; // its part number is on another shape in the BOM too (Name collision, warn only)
};

// The Onshape state a version comes from: the Manufacture document's microversion and, per
// document inserted by version, that version ("V70"); `from` is what the parts used before.
// `parts`: how many of the BOM's parts come from that document; `main`: the document most of
// them come from, which names the version (label.ts). Versions read before these were kept lack both.
type DocVersions = Record<string, { versionId: string; name: string; parts?: number; main?: boolean }>;
// `vid`: the assembly's own Onshape version, for a system that follows versions.
export type VersionRef = { mv: string | null; did: string; vid?: string; sources?: DocVersions; from?: DocVersions };

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

// ---------- CAD Review (plan/design-review.md) ----------

// A comment on a system's design and its status (Harel, 2026-11-13; ticks before): Open, On it
// (someone is working on it), To check (waiting for a mentor; the Update system window sets it
// for the comments it ticks) and Done (a mentor approved it). A mentor sending a To check one
// back writes why. Rules: src/lib/reviews/status.ts.
// Design Reviews (plan/cad-design-review.md, Harel 2026-11-18): an admin starts one on a robot (the
// whole robot or some systems) with a State text; comments written while it's open are tagged to
// it. `robot_version_id`: the robot's newest version at Start (none made); `finish_version_id`: one
// made at Finish when asked. Their labels are kept for when a version is deleted. One open per robot.
export const designReviews = pgTable(
  "design_reviews",
  {
    id: id(),
    robotId: uuid("robot_id")
      .notNull()
      .references(() => robots.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    wholeRobot: boolean("whole_robot").notNull().default(true),
    systemIds: jsonb("system_ids").$type<string[]>().notNull().default([]),
    state: text("state").notNull(),
    robotVersionId: uuid("robot_version_id").references(() => robotVersions.id, { onDelete: "set null" }),
    versionLabel: text("version_label"),
    finishVersionId: uuid("finish_version_id").references(() => robotVersions.id, { onDelete: "set null" }),
    finishVersionLabel: text("finish_version_label"),
    startedBy: uuid("started_by").references(() => members.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedBy: uuid("finished_by").references(() => members.id, { onDelete: "set null" }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("design_reviews_seq_uq").on(t.robotId, t.seq), uniqueIndex("design_reviews_open_uq").on(t.robotId).where(sql`${t.finishedAt} IS NULL`)],
);

export const reviewCommentState = pgEnum("review_comment_state", ["open", "on_it", "to_check", "done"]);
// A snip of the 3D view on a comment, with lines drawn on it (Harel, 2026-11-10): the picture in
// R2, the lines kept apart so they can still be erased (the author any, others their own). `p`:
// x, y pairs in the picture's pixels; `s`: the pen's width there. `changed`: members other than
// the author who drew on it.
export type SnipStroke = { by: string; c: string; s: number; p: number[] };
export type Snip = { path: string; w: number; h: number; strokes: SnipStroke[]; changed?: { by: string; name: string; at: string }[] };
export const reviewComments = pgTable(
  "review_comments",
  {
    id: id(),
    robotId: uuid("robot_id")
      .notNull()
      .references(() => robots.id, { onDelete: "cascade" }),
    // Null: a comment on the whole robot (the robot's CAD page, Harel 2026-11-09).
    systemId: uuid("system_id").references(() => systems.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => members.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    // The part it is about (the 3D model's key, did:eid:partId) and its name then, kept for when
    // the part is gone from a newer version.
    partKey: text("part_key"),
    partName: text("part_name"),
    // The Onshape version of the design document it was written on, from the Onshape panel: the
    // version open there, or the document's newest one when Onshape was on the workspace. Null
    // (written on the site): the tree places it by its date (Harel, 2026-11-09).
    onshapeVersionId: text("onshape_version_id"),
    onshapeVersionName: text("onshape_version_name"),
    state: reviewCommentState("state").notNull().default("open"),
    snip: jsonb("snip").$type<Snip>(),
    // The 3D view it was written in (viewState.ts: camera, hidden parts, section, colours) and its
    // pin, the newest pick's point in assembly mm; a tap on the comment turns the view back (S6).
    view: jsonb("view").$type<ViewState>(),
    pin: jsonb("pin").$type<[number, number, number]>(),
    // Which 3D model it was written on: the Basepart or the Final (Harel, 2026-11-12). Both show
    // in the system's comments; a tap opens the one it was written on.
    model: text("model").$type<ModelKind>().notNull().default("final"),
    createdAt: createdAt(),
    // Who took it on (On it) and when.
    onItAt: timestamp("on_it_at", { withTimezone: true }),
    onItBy: uuid("on_it_by").references(() => members.id, { onDelete: "set null" }),
    // Who set To check and when (the columns kept their names from when it was "ticked off").
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: uuid("done_by").references(() => members.id, { onDelete: "set null" }),
    // Set To check in the Update system window: the version that was committed.
    doneVersionId: uuid("done_version_id").references(() => systemVersions.id, { onDelete: "set null" }),
    // Who set Done (approved) and when.
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => members.id, { onDelete: "set null" }),
    // The last rejection: why, by whom and when.
    rejectNote: text("reject_note"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => members.id, { onDelete: "set null" }),
    // Its author changed the text after posting it (shown as "edited", Harel 2026-11-13).
    editedAt: timestamp("edited_at", { withTimezone: true }),
    // The face, edge or corner it is about (Harel, 2026-11-18): src/lib/reviews/anchor.ts.
    anchor: jsonb("anchor").$type<Anchor>(),
    // Every face / edge / corner it's about, of any parts (Harel, 2026-11-18); `anchor` is the first.
    anchors: jsonb("anchors").$type<Anchor[]>(),
    // The Design Review it belongs to (Harel, 2026-11-18).
    designReviewId: uuid("design_review_id").references(() => designReviews.id, { onDelete: "set null" }),
  },
  (t) => [
    index("review_comments_design_review_idx").on(t.designReviewId),
    index("review_comments_system_idx").on(t.systemId, t.createdAt),
    index("review_comments_robot_idx").on(t.robotId, t.createdAt),
    index("review_comments_done_version_idx").on(t.doneVersionId),
  ],
);

// Replies under a CAD comment, a thread like Onshape's (Harel, 2026-11-13). No status of their
// own; a mentor's "sent back" note is posted as one.
export const reviewCommentReplies = pgTable(
  "review_comment_replies",
  {
    id: id(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => reviewComments.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => members.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    // A snip and a linked part, like a comment's (Harel, 2026-11-17).
    snip: jsonb("snip").$type<Snip>(),
    partKey: text("part_key"),
    partName: text("part_name"),
    createdAt: createdAt(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [index("review_comment_replies_comment_idx").on(t.commentId, t.createdAt)],
);

// Onshape's Named views of a robot's 3D view (S6, plan/cad-3d-viewer.md): saved from the view
// cube's menu, shared by the team, on the robot's and its systems' CAD pages.
export const namedViews = pgTable(
  "named_views",
  {
    id: id(),
    robotId: uuid("robot_id")
      .notNull()
      .references(() => robots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    view: jsonb("view").$type<ViewState>().notNull(),
    createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("named_views_robot_idx").on(t.robotId, t.name)],
);

// Design check runs (plan/design-check.md): weight, frame perimeter and interference worked out
// in a CAD member's browser from the robot's 3D model and saved here for the team. The newest per
// robot and model is the one shown; older ones are dropped on save.
export const designChecks = pgTable(
  "design_checks",
  {
    id: id(),
    robotId: uuid("robot_id")
      .notNull()
      .references(() => robots.id, { onDelete: "cascade" }),
    model: text("model").notNull().default("final"), // "final" | "basepart"
    sig: text("sig").notNull(), // the 3D model it ran on: a newer model means old results
    results: jsonb("results").$type<CheckResults>().notNull(),
    ranBy: uuid("ran_by").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("design_checks_robot_idx").on(t.robotId, t.model, t.createdAt)],
);

// Interference a CAD member marked as fine (a press fit, a part drawn on purpose that way): the
// part pair (pairKey in src/lib/check/types.ts) isn't checked again on this robot.
export const designCheckIgnores = pgTable(
  "design_check_ignores",
  {
    robotId: uuid("robot_id")
      .notNull()
      .references(() => robots.id, { onDelete: "cascade" }),
    pair: text("pair").notNull(),
    createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.robotId, t.pair] })],
);

// A part's real weight, set by hand on the CAD page's weight list (a motor, a gearbox: what the
// mesh's volume can't tell). Keyed by the BOM key (did:eid:partId), so a COTS part keeps it in
// every system and robot that uses the same Onshape part. Grams, one copy.
export const partWeights = pgTable("part_weights", {
  key: text("key").primaryKey(),
  grams: real("grams").notNull(),
  setBy: uuid("set_by").references(() => members.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  (t) => [index("part_releases_part_idx").on(t.partId), index("part_releases_version_idx").on(t.versionId)],
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

// The shop map's places (Harel, 2026-11-14): a zone (parent_id null) is an outline on the floor
// plan (config/workshopMap.ts units) with an optional first-person picture; a spot (parent_id =
// its zone) is one drawer / shelf / bin pinned on that picture (spot_x / spot_y its centre, spot_w / spot_h its size, 0..1 of it).
// Items, groups, categories and system drawers point at either. The map never shows `name`; it
// stays for the AI tools, search, history and backups. No foreign key on parent_id, so a restore
// can insert the rows in any order; deleting a zone moves its spots' items to nothing in code.
export type MapPoint = [number, number];
export type SpotKind = "drawer" | "shelf" | "bin";
export const inventoryLocations = pgTable("inventory_locations", {
  id: id(),
  name: text("name").notNull().unique(),
  parentId: uuid("parent_id"),
  outline: jsonb("outline").$type<MapPoint[]>(),
  color: text("color"),
  // The zone's first-person picture: an R2 key, or a /public path; its size in pixels.
  imageKey: text("image_key"),
  imageW: integer("image_w"),
  imageH: integer("image_h"),
  // Which way the picture looks, in degrees on the floor plan (0 = up), for the dive.
  facing: real("facing").notNull().default(0),
  spotX: real("spot_x"),
  spotY: real("spot_y"),
  // The spot's tag is a rectangle over the drawer in the picture (Harel, 2026-11-17): its width and
  // height as fractions of the picture, so it stays on the drawer at any zoom. Null = a default.
  spotW: real("spot_w"),
  spotH: real("spot_h"),
  kind: text("kind").$type<SpotKind>(),
  position: integer("position").notNull().default(0),
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

// The team's bores (1/2" Hex, SplineXS...), edited on the Settings page. An options field set to
// the global Bore list offers all of them plus its own extras (Harel, 2026-11-12); seeded from
// BORES in src/config/inventory.ts.
export const bores = pgTable("bores", {
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
  // "bores": an options field that offers the global Bore list (Settings → Bores) before its own
  // `options`, which then hold only its extras (Harel, 2026-11-12).
  list?: "bores";
  // Such a field's own extras when categories are read, `options` being the whole merged list
  // (never stored).
  ownOptions?: string[];
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
  // Each item is one station's kind of computer and its stock is its rows in inventory_devices,
  // each placed on the zone's picture (Computers & Devices, Harel 2026-11-20).
  devices: boolean("devices").notNull().default(false),
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
  // One of the three PC stations (config/stations.ts): its stock is its PCs in inventory_devices.
  station: text("station").unique(),
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
  (t) => [
    index("inventory_moves_item_idx").on(t.itemId, t.at),
    index("inventory_moves_batch_idx").on(t.batchId),
    index("inventory_moves_visit_idx").on(t.visitId),
    index("inventory_moves_part_idx").on(t.partId),
  ],
);

// One PC of a station (config/stations.ts, Harel 2026-11-20): the item's stock is how many of
// these rows it has (lib/inventory/moves.ts keeps them in step). x / y are its icon's place on the
// floor plan (config/workshopMap.ts units); condition 1-5. `specs` is unused.
export const inventoryDevices = pgTable(
  "inventory_devices",
  {
    id: id(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    x: real("x").notNull().default(0.5),
    y: real("y").notNull().default(0.5),
    keyboard: boolean("keyboard").notNull().default(false),
    mouse: boolean("mouse").notNull().default(false),
    note: text("note"),
    condition: smallint("condition"),
    // A PC's own name and its parts, free text (Harel, 2026-11-20); no name shows "PC n".
    name: text("name"),
    gpu: text("gpu"),
    cpu: text("cpu"),
    ram: text("ram"),
    specs: jsonb("specs").$type<Record<string, string>>().notNull().default({}),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_devices_item_idx").on(t.itemId, t.position)],
);

// Every COTS order, one card each on the COTS Order History page and in the item's Past orders:
// when it went In Route and when it arrived (Arrived or In Stock). Status moves undone within a
// day take the card back; later ones leave it (lib/parts/orderHistory.ts, Harel 2026-11-02).
// A date the team never recorded can hold typed text instead (in_route_text, arrived_text).
export const cotsOrderHistory = pgTable(
  "cots_order_history",
  {
    id: id(),
    inventoryItemId: uuid("inventory_item_id").references(() => inventoryItems.id, { onDelete: "cascade" }),
    partId: uuid("part_id").references(() => parts.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: real("unit_price"),
    vendor: text("vendor"),
    productUrl: text("product_url"),
    inRouteAt: timestamp("in_route_at", { withTimezone: true }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    inRouteText: text("in_route_text"),
    arrivedText: text("arrived_text"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cots_order_history_part_idx").on(t.partId), index("cots_order_history_item_idx").on(t.inventoryItemId)],
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

// Every Onshape call the team made, per day (config/onshapeBudget.ts): the team's daily cap
// and the yearly allowance are counted from here.
export const onshapeUsage = pgTable("onshape_usage", {
  day: date("day").primaryKey(),
  calls: integer("calls").notNull().default(0),
  background: integer("background").notNull().default(0), // of them, automatic (thumbnails, previews)
});

// Paid or capped outside APIs counted per day (Serper web search and Lens, Gemini), so a daily
// cap survives restarts and deploys (src/lib/apiUsage.ts, limits in src/config/apiLimits.ts).
export const apiUsage = pgTable(
  "api_usage",
  {
    day: date("day").notNull(),
    service: text("service").notNull(),
    calls: integer("calls").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.service] })],
);

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

// ---------- Recently deleted ----------

// What a delete removed, kept 30 days so an admin can bring it back (lib/trash.ts): the row and
// every row the database cascaded with it (systems, parts, history, versions, stock moves...),
// table by table in parent-first order, plus links that were emptied. Its R2 files are deleted
// only when the entry is purged.
export type DeletedRows = {
  tables: { table: string; rows: Record<string, unknown>[] }[];
  links: { table: string; column: string; value: unknown; ids: Record<string, unknown>[] }[];
};
export const deletedRecords = pgTable(
  "deleted_records",
  {
    id: id(),
    kind: text("kind").$type<"robot" | "system" | "part" | "item">().notNull(),
    label: text("label").notNull(),
    rows: jsonb("rows").$type<DeletedRows>().notNull(),
    fileKeys: text("file_keys").array().notNull().default(sql`'{}'::text[]`),
    deletedBy: uuid("deleted_by").references(() => members.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deleted_records_at_idx").on(t.deletedAt)],
);

// ---------- New parts glow ----------

// When each member last opened each page that lists arriving parts (src/lib/seen.ts): "fab:<robot>",
// "print:<robot>:<printer>", "factory:<robot>:<factory>", "cots:released", "cots:order". A part
// whose stage_at is later glows for them, in the side panel and on the page (Harel, 2026-11-05).
export const pageSeen = pgTable(
  "page_seen",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    page: text("page").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.page] })],
);

// ---------- Assembly page (plan/assembly-guides.md, Harel 2026-11-10) ----------
// Sub-assemblies come from part numbers (src/lib/assembly/groups.ts); this only keeps the names
// CAD gives them, per system and code ("42").
export const assemblySubs = pgTable(
  "assembly_subs",
  {
    systemId: uuid("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.systemId, t.code] })],
);

// The camera a step was saved with (the viewer's ViewPose).
export type StepCamera = { target: [number, number, number]; dir: [number, number, number]; half: number; projection: "ortho" | "perspective" };

// One assembly step, in a system's own column (sub_code null) or in one of its sub-assemblies.
// kind "sub": a step that stands for a whole sub-assembly (sub_ref) in the system's column.
export const assemblySteps = pgTable(
  "assembly_steps",
  {
    id: id(),
    systemId: uuid("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    subCode: text("sub_code"),
    position: integer("position").notNull().default(0),
    kind: text("kind").$type<"step" | "sub">().notNull().default("step"),
    subRef: text("sub_ref"),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    critical: boolean("critical").notNull().default(false),
    // The parts this step adds (3D model keys, did:eid:partId).
    partKeys: text("part_keys").array().notNull().default(sql`'{}'::text[]`),
    // Earlier steps of the same column brought in whole, each drawn in one colour (Harel, 2026-11-10).
    stepRefs: uuid("step_refs").array().notNull().default(sql`'{}'::uuid[]`),
    camera: jsonb("camera").$type<StepCamera>(),
    // A still of the step's 3D, taken when it was saved (R2), for the slides not on screen.
    imageKey: text("image_key"),
    createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assembly_steps_place_idx").on(t.systemId, t.subCode, t.position)],
);

// A built step: one row per step (the robot is the step's system's), with who ticked it.
export const assemblyTicks = pgTable("assembly_ticks", {
  stepId: uuid("step_id")
    .primaryKey()
    .references(() => assemblySteps.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
  doneAt: timestamp("done_at", { withTimezone: true }).notNull().defaultNow(),
});

// One counter per table the server keeps in memory (src/lib/data/cache.ts). Triggers (migration
// 0083) add one when a transaction that wrote the table commits, so a cached read is reused
// until its tables change. Keeps Supabase's egress inside the free 5 GB (Harel, 2026-11-11).
export const dataVersions = pgTable("data_versions", {
  name: text("name").primaryKey(),
  version: bigint("version", { mode: "number" }).notNull().default(0),
});
