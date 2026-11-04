# Team 1690 BOM + Onshape app: architecture plan (v1.0)

Status: final plan, 2026-10-16. Owner: Harel.
Sources: `frcbom-handoff.md`, Harel's answers in the planning thread, and the FRCBOM reference at [`uploads/frcbom-reference/frcbom-reference.md`](../uploads/frcbom-reference/frcbom-reference.md) (with screenshots in the same folder). Section numbers like "ref §2a" point into that reference.

---

## 0. Decisions

| Topic | Decision |
|---|---|
| Purpose | **Strictly a BOM + inventory manager**, used **this season** (2027). |
| Fidelity | The BOM, inventory and Onshape integration work **the same as FRCBOM**. Copy, don't redesign. |
| Out of scope | Planner, Insights, Settings pages, custom roles, certifications, process/material managers, part-number rules, Orders, and importing old FRCBOM data. Each robot starts fresh from Onshape. |
| Settings | No settings UI. Statuses, machines, materials, file types and part-type templates live in code (`config/*.ts`) and we edit them directly. Inventory groups, locations and conditions stay editable from the Inventory toolbar, the same as FRCBOM. |
| Login | Google (Supabase Auth). |
| Roles | **Member** (edit everything in the BOM and inventory, upload files) and **Admin** (invite and remove members, delete robots, systems and files, Advanced Onshape panel). |
| Hosting | **$0**: Vercel Hobby + Supabase Free + Cloudflare R2 (§1). |
| Onshape | Team **Enterprise**; each student connects their own account (OAuth). Harel approves the OAuth app as enterprise admin. |
| AI | **MCP server only**, used through members' personal Claude accounts. No in-site chat, so AI costs nothing to host (§6). |

---

## 1. Hosting and stack

**Next.js (App Router, TypeScript) on Vercel Hobby + Supabase Free (Postgres, Auth, Realtime) + Cloudflare R2 for files.**

| Free-tier limit | Workaround |
|---|---|
| Supabase pauses a free project after 7 days idle | Daily keep-alive cron (Vercel Cron) |
| Supabase gives 1 GB of storage | Drawings, gcode, images, flattened files and cached CAD exports go to **R2** (10 GB free, no download fees). Thumbnails also go to R2. |
| No automatic backups on the free plan | Nightly GitHub Action runs `pg_dump` into a private repo. A restore test is in the runbook. |
| Vercel functions time out after 60 s | Sync and CAD export run as resumable steps in `sync_jobs`. |

Libraries: Tailwind + shadcn/ui (FRCBOM is also Tailwind), dnd-kit for Kanban, Drizzle for schema and migrations, `@modelcontextprotocol/sdk` for MCP, and `@google/model-viewer` for the 3D view (glTF).

**Ownership:** Vercel, Supabase, R2, GitHub and the Onshape OAuth app belong to a team/mentor Google account, not a student's, so they outlive graduation.

**Security improvement over FRCBOM:** Onshape tokens and keys never reach the browser (FRCBOM sends key material to the client, ref "Unclear" #12).

---

## 2. Screens (FRCBOM parity)

Navigation: **Build** (Home, My Parts, Part Groups) · **Shop** (Inventory) · **Team** (Members).

| Screen | Contents (ref section) |
|---|---|
| **Home** | Robot cards: name, year, thumbnail, archive and delete. New robot form: name\*, competition year\*, main assembly URL (thumbnail only), schematic image (ref §1). |
| **Robot page** | Completion % and "N / M parts done", stacked status bar with count and % per status, systems list (thumbnail, done/total, progress bar), "Inventory on this robot" panel, New system dialog (name + assembly URL, with auto-discovery of subassemblies and part studios). Robot code and deadline fields. No milestone timeline (that belongs to the Planner). |
| **System BOM page** | Header (editable name, %, status legend). Ctrl-K search. Filter chips (All, COTS, In-house, one chip per machine). Material and Status selects. Bulk download by material. **Card / Table / Kanban** views. Toolbar: Bulk edit, Link Onshape drawings, Sync to Onshape toggle, Revert names ▾, Manual part, Merge parts, Group parts. Admin-only **Advanced** panel at the bottom (ref §3). |
| **Main** | Robot-wide pseudo-system with every part of every system. Same views, but no merge, bulk edit or Advanced panel (ref §1). |
| **My Parts** | Parts where I'm the designer or a fabricator. A filter only. |
| **Part Groups** | Groups with done/total, status counts, group files, priority, **Set status for all**, missing members with **Why?** and **Recover** (ref §1, §6). |
| **Inventory** | Groups tree, toolbar (Groups, Part types, Conditions, Locations, Import spreadsheet, Add item), filters, item cards with stepper, **To BOM** and Edit; item form with part-type detail fields and a vendor URL (ref §5). |
| **Members** | List, single-use invite links, join requests, admin flag. |

**The card is the editor**, as in FRCBOM. Every field on a part card opens an inline popover (searchable list, or an input with Cancel/Save). The only stand-alone form is **Add Manual Part** (ref §2a–b). The Table view uses the same popover editors in its cells (columns per ref §3). Dragging a card between Kanban columns changes its status.

FRCBOM feature flags, set for 1690: notes **on**, est/actual time **on**, part groups **on**, per-process fabricator **on**, box mode **off**, External type **off**, Orders **off**.

---

## 3. Data model

Postgres via Drizzle. `*` marks a field that comes from Onshape and is refreshed on sync unless it appears in `overridden_fields`.

```
members(id, user_id, email, name, is_admin, onshape_connected)
invites(token, created_by, used_by, expires_at)
join_requests(user_id, created_at, status)

robots(id, name, year, code, deadline, main_assembly_url, schematic_path, thumbnail_path, archived)
systems(id, robot_id, name, assembly_url, subassembly_urls[], partstudio_urls[],
        push_names_to_onshape bool, last_synced_at, doc_microversions jsonb)

parts(                                   -- one BOM row
  id, system_id,
  -- identity (ref §6): source_did, source_wid, source_eid, source_wvm, onshape_part_id, onshape_name
  source_did, source_wid, source_eid, source_wvm, onshape_part_id, onshape_name*,
  is_manual, display_name, part_number,
  classification: inhouse|cots|external,
  description*, material*, inventory_item_id, quantity*,
  pre_process*, process1*, process2*, extra_processes jsonb,     -- machine ids
  done_preprocess, done_process1, done_process2,                 -- counters drive status
  design_state,                                                  -- stored status for design stages
  priority: critical|high|normal|low, deadline,
  designer_name, fabricators jsonb {slot: name},
  note, est_minutes, actual_minutes,
  drawing_url, dxf_face, box_qty,
  overridden_fields text[],                                      -- site value wins over Onshape
  geometry jsonb* (bbox, min_dim, body_type, volume, mass),      -- for AI classification (§6)
  class_guess, class_source: rule|ai|manual,
  thumbnail_rev, removed_from_cad_at,
  last_modified_at, last_modified_by
)
part_files(part_id, type: drawing|gcode|image|flattened, r2_key, filename, content_type, uploaded_by, uploaded_at)
merges(id, system_id, name, overrides jsonb)       merge_members(merge_id, part_id)
part_groups(id, robot_id, name, color, description, priority)  group_members(group_id, part_id, key_snapshot)
group_files(group_id, r2_key, filename, type)
part_history(part_id, field, old, new, user_id, via: ui|sync|mcp, batch_id, at)   -- audit + undo

inventory_groups(id, name, parent_id, template_id, location_id)
inventory_items(id, name, group_id, template_id, template_values jsonb, condition_id, location_id,
                in_stock, material, image_path, vendor_url, vendor_name, price)
inventory_locations(id, name)    inventory_conditions(id, label, color)

onshape_tokens(member_id, access_token_enc, refresh_token_enc, expires_at, calls_today, calls_day)
onshape_cache(key, microversion, payload jsonb, fetched_at)
sync_jobs(id, system_id, kind, state, step, diff jsonb, error, by_member, started_at, finished_at)
```

Code config (`config/`): `statuses.ts` (name, color, kind, done flag), `machines.ts` (name, stage, cad_format), `materials.ts` (category → list), `fileTypes.ts`, `partTypes.ts` (inventory templates with fields, options, material_source, name_pattern), `onshapeProperties.ts` (custom property IDs for material and processes). The initial contents are copied from ref §4–5, with the typos fixed ("In Process 1", "1.5mm").

**Inventory allocation and usage are computed, not stored.** A view matches COTS parts to items by `inventory_item_id`, or else by vendor URL, then fills each robot's needs once per robot (ref §5). This gives "Qty In Stock", "Used by N parts" and the robot's inventory panel without counters drifting out of sync.

### Status logic (copied from FRCBOM, ref §4)
- The 14 visible statuses come from `statuses.ts`. **Done** statuses: Ready for QA, In Stock, In Spare Stock.
- A new part is **Not Started**. While every `done_*` counter is 0, the status is the stored `design_state` (any design-stage status).
- Once any counter is above 0, the status is **derived**: "In Process 1" / "Ready for Process 2" / … from the first unfinished slot, and `design_state` is cleared. A part parked in a done status counts as done.
- COTS parts only use design-stage statuses.
- One function, `computeStatus(part)`, is shared by the UI, the stats views and MCP, and unit-tested against FRCBOM's behaviour.

---

## 4. Onshape integration

### Connection
- OAuth app registered under the Enterprise (Harel approves it). Each member clicks **Connect Onshape** once.
- A sync runs on the account of the member who triggers it. The background refresh uses Harel's account, or a dedicated "bom-bot" seat if one is free.
- Every call is counted. At 2,200 calls a day an account switches to read-from-cache with a banner. The Onshape test confirms the real Enterprise limit.

### What we read and write (same as FRCBOM, ref §6)
| Operation | When | Onshape calls |
|---|---|---|
| **Discover** subassemblies and part studios from the assembly URL | New system / "Update URLs from Onshape" | 1–2 |
| **Change check**: microversion of each document the system uses | Every refresh | 1 per document |
| **Update BOM**: assembly BOM with part properties, including the **custom properties** for Material, Pre Process, Process 1 and Process 2 | Only when a microversion changed | 1 per system |
| **Geometry** (bounding box, body type, mass) per Part Studio | Only for changed Part Studios | 1–2 per studio |
| **Thumbnails** | New or changed parts only; cached in R2 | 1 per part |
| **3D view (glTF)** and **CAD export** in the machine's format (STEP / STL / x_t / DXF flat face / PDF drawing) | On click, cached in R2 per part microversion | 2–4 per export (start, poll, download) |
| **Link Onshape drawings**: find drawings in the system's documents and match them to parts **by name**, as a dry run first, then confirm | On click | 1 per document |
| **Push names**: write `part_number + name` back to the Onshape part name when the system's toggle is on; **Revert names ▾** restores the originals or re-pulls them | On P/N change / click | 1 batched call per Part Studio |

**Background refresh every 10 minutes**, as in FRCBOM, but gated: if no document microversion changed, the refresh costs one call per document and stops. A typical day is about 6 systems × 2 documents × 6 refreshes an hour × 4 meeting hours ≈ 300 cheap calls, plus real syncs. Outside meeting hours the refresh rate drops to once an hour.

### Sync merge rules
- Part identity is `source_did/wid/eid + onshape_part_id + onshape_name`, as in FRCBOM. Team renames go to `display_name`, so they never break identity.
- Fields marked `*` update from Onshape **unless** they are in `overridden_fields`. Editing one in the app adds it there, the same as FRCBOM.
- App-only fields (status, counters, priority, deadline, people, notes, times, files, groups, merges) are never touched by a sync. "Existing part numbers, statuses, progress and notes are kept, including across an assembly version bump."
- **Parts that disappear from CAD:** FRCBOM's server-side behaviour here wasn't visible (ref "Unclear" #2). Our rule: the row is hidden from the board and `removed_from_cad_at` is set, keeping its data. If a part with the same name reappears (a re-keyed part), it is **re-linked automatically**, keeping status and files. The sync diff lists what was removed or re-linked. Part Groups use this for **Why?** and **Recover**.

### FRCBOM panel inside Onshape
FRCBOM's main way to add systems is a side panel inside Onshape. For v1 we use the New-system dialog with an assembly URL and auto-discovery, which covers the same need. The **Onshape side panel** (an Onshape app extension showing our system page filtered to the current document) is v1.2.

---

## 5. Work allocation: the Onshape properties question

FRCBOM reads Material and the processes from Onshape **custom part properties** (ref §6, "Unclear" #7). That means designers can set them in CAD and they flow into the BOM. We do the same. The open question is the reverse direction: when someone edits a material or process in the app (or through AI), should it also be **written back to the Onshape property**?
- **Default: no**, the same as FRCBOM. The edit goes into `overridden_fields` and the app value wins.
- Writing back would keep CAD and BOM in sync but costs calls and needs edit access to the documents. It can be added later as a per-system toggle, like push names.

---

## 6. AI: change the site with prompts (MCP)

Members add the app's MCP server to their own Claude (desktop or web) with a personal token from their profile page, then type prompts like:

> *"Define material and machine for all parts recognised as aluminum plates."*

### Tools (same permission checks and history as the UI)
- **Read:** `list_robots`, `list_systems`, `find_parts(filters: system, status, classification, machine, material, class_guess, text, missing_files…)`, `get_part`, `system_stats`, `search_inventory`, `inventory_usage`.
- **Write:** `update_parts(ids, changes)` with the same fields as Bulk edit (Type, Material, Pre Process, Process 1, Process 2, Status) plus priority, deadline, designer, fabricator, notes and counters. Also `add_manual_part`, `group_parts`, `set_group_status`, `link_inventory`, `adjust_stock`, `add_inventory_item`, `update_bom_from_onshape(system)`.
- **Safety:** every write tool returns a **preview first** (which parts, old → new). The change is applied only with a `confirm_token` from that preview, and is recorded in `part_history` under one `batch_id`. **`undo_batch(batch_id)`** reverts the whole batch. Changes over 50 parts require a second confirmation.
- **Reference:** `list_machines`, `list_materials`, `list_statuses`, so Claude uses exact names.

### Recognising part types (for "aluminum plates" style prompts)
Each sync stores geometry, and simple rules set `class_guess`. Claude sorts out the ambiguous parts in the conversation itself, so no AI runs on our server:
- **Plate:** sheet-metal body, or a solid whose smallest dimension matches a plate thickness in `materials.ts` and is much smaller than the other two. The Onshape material decides aluminum or polycarbonate.
- **Tube / extrusion / shaft:** one long axis with a cross-section matching a tube, extrusion or hex profile in `materials.ts`.
- **3D print:** material in the "3D Printed" category.
- **COTS:** comes from a library or vendor document, or matches an inventory item.

For the example prompt, Claude calls `find_parts(class_guess=plate, onshape_material~aluminum)`. It looks at the matches, maps each part's thickness to the right "Nmm 6061-T6" material, picks the machine (e.g. CNC or HadasaS), previews, and applies after the member confirms.

---

## 7. Build order (≈ 12 weeks to kickoff, early January 2027)

| Week of | Milestone |
|---|---|
| Oct 19 | Accounts (team Google, GitHub, Vercel, Supabase, R2). Onshape OAuth app. **Onshape test**: pull one real system (BOM with custom properties, geometry, thumbnail, export) and count the calls. Repo scaffold, schema, Google login, members and invites. |
| Oct 26 – Nov 2 | Robots and systems, New-system auto-discovery, **Update BOM from Onshape**, thumbnails, the card with all popover editors, `computeStatus`, Main view. |
| Nov 9 | Table and Kanban views (drag to change status), search, chips, filters, bulk edit, live updates. |
| Nov 16 | Files on R2 (drawing, gcode, image, flattened), Link Onshape drawings, CAD export by machine format, bulk download by material, 3D viewer. |
| Nov 23 – 30 | **Inventory:** groups, items, part types, conditions, locations, stepper, spreadsheet import, To BOM, allocation and usage, robot inventory panel. |
| Dec 7 | Manual parts, merge/unmerge, Part Groups (with missing members and Recover), push names, revert names, removed-part handling, background refresh. |
| Dec 14 | **MCP server** + geometry classification + preview/undo. |
| Dec 21 – Jan 4 | Team beta on a prototype robot, fixes, runbook (deploy, restore a backup, rotate the Onshape app secret), member onboarding. |
| Kickoff | Robot 2027 created fresh, connected to Onshape, in use. |

**If time runs short, cut in this order:** 3D viewer → merge parts → part-type templates (keep plain inventory items) → bulk download. The core (sync, card, statuses, Kanban, inventory, MCP) stays.

---

## 8. Open questions

1. **Who besides Harel can deploy and fix the app** during the season? This decides who else gets access to the Vercel, Supabase and GitHub accounts.
2. **Onshape custom properties:** does the team's CAD template already define the Material / Pre Process / Process 1 / Process 2 custom properties that FRCBOM reads? The Onshape test needs those property IDs.
3. **Write-back of material and process to Onshape** (§5): keep FRCBOM's behaviour (app only) for v1?

## 9. Next steps

1. **Answer the questions in §8.**
2. **Create the accounts** under a team Google account: GitHub org repo, Vercel, Supabase, Cloudflare R2.
3. **Register the Onshape OAuth app** in the Developer Portal under the Enterprise. I'll write a step-by-step with the exact scopes and redirect URL when we scaffold.
4. **Start the build** (week of Oct 19): I can scaffold the repo, schema, config files and Google login, and write the Onshape test script, as soon as a GitHub repo exists and is connected to this project.
