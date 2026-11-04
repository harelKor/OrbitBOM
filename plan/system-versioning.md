# System version control: plan

Status: v0.7. All rounds 1–6 built and on main (rounds 5–6 b7d4442: Recent actions Revert + light-blue System Update actions; Undo/Redo covers the member's own part edits, not stock moves or commits). Earlier: rounds 1–4 built and on main (round 4 storage, 9faffae: stored_files ledger 0028, nightly recount + clean-up in the keep-alive cron, dashboard storage box, ?storage=1 opens the window). Rounds 1–3 (2026-10-24; round 3 = Versions window, Revert, held/Outdated parts, right-panel Outdated tag, dashboard Onshape sync box, commit bb4e804): migrations 0025_system_versions, 0026_shape_sig, 0027_partial_commits. Change detection uses a shape fingerprint (volume, area, principal inertia from Onshape mass properties), not the part microversion, which changes on every regenerated version. Harel: anyone in Edit mode commits; versioning on for every system. Plan complete.
v0.2: Harel's answers to the first four questions are folded in (§12).
Thread: "System version control plan". Repo state read: `main` at a82d934 (after PR #37).

## 1. The idea in one paragraph

Today Update BOM (and the background refresh every few minutes) copies whatever the Manufacture assembly says straight into the BOM. Versioning puts a gate in between: the app keeps checking Onshape, but a change only reaches the BOM when someone **commits** it. Each commit is a **version** of the system. Every part points at the version of itself that fab should make, so a part can be behind (Outdated) while the rest are current, and a whole system can be pointed back at an older version (Revert) without touching Onshape.

The most important finding from reading the code: **the 3D files are only previews; the real record is the Onshape reference.** The Manufacture assembly inserts the CAD document at an Onshape *version* (`v/<id>`), and Part Studios inside the Manufacture document can be read at a *microversion* (`m/<id>`). Both are frozen forever in Onshape and cost us nothing to keep. So a version row stores those references (a few hundred bytes), downloads and drawings of an old version still work exactly, and deleting old meshes to save space only loses the Before/After picture, never the ability to revert or fabricate. That makes the storage problem small (§5).

## 2. What exists today (and what it means for this)

| Area | Today | Effect on versioning |
|---|---|---|
| BOM sync | `src/lib/sync/updateBom.ts` + `merge.ts`: one BOM call, match by did:eid:partId (re-link by name), fields refresh, missing parts get `removed_from_cad_at` | The merge plan (`planMerge`) is reused as the **diff**; it just stops being applied automatically |
| Change check | `systems.doc_microversions` vs `currentmicroversion` (1 call); cron `refreshDueSystems` | Becomes "detect and store a draft", never "apply" |
| Part identity | `parts.source_did/wid/wvm/eid/onshape_part_id`; identity is refreshed on every sync | Becomes the **committed** reference; only commit/revert moves it |
| Part change signal | `parts.thumbnail_rev` = Onshape part `microversionId` from the parts list (1 call per Part Studio) | Same call tells us which parts' geometry changed |
| Meshes | `src/lib/model/build.ts`: one gzipped mesh per Part Studio revision in R2 (`models/studios/<did>/<eid>/<hash>.bin.gz`); `part.ts` exports one part (`models/parts/<id>/…`). **Old files are never deleted today.** | Versions reference these files; a garbage collector is needed anyway |
| History / undo | `part_history` (field, old, new, batch_id, visit_id); `planUndo` skips fields edited later | Reused for Recent Actions revert and Undo/Redo |
| Recent Actions | `src/lib/data/actions.ts`: one action = one page visit's part changes | Add a second action kind: System Update (light blue) |
| QA box | `src/components/qa/QaBox.tsx` on the robot dashboard | Shares its grid cell with the new Sync box |
| Onshape panel | `/onshape/panel` redirects a linked assembly to its system page | Adds `?check=1` so the system page runs detection on open |
| Mode | `getMode()` cookie, Edit by default | Commit, Revert, Delete version are Edit-mode only |

## 3. Data model (one migration, next free number when built)

```
system_versions
  id, system_id → systems (cascade)
  seq int                -- 1, 2, 3… per system; v0 = baseline
  state enum: draft | committed
  name text              -- prefilled from the Onshape version name, editable
  onshape_ref jsonb      -- { manufactureMv, sources: { [cadDid]: { versionId, versionName } } }
  summary jsonb          -- { added, modified, removed, propsOnly } counts for list rows
  detected_at, committed_at, committed_by → members
  previews_removed_at    -- set when storage clean-up dropped its meshes
  unique (system_id, seq)

part_versions            -- one row per part per version that CHANGED it (sparse)
  id, version_id → system_versions (cascade), part_id → parts (cascade, null for a part
     that is added but not committed yet), part_key text (did:eid:partId)
  change enum: added | modified | removed | props
  snapshot jsonb         -- identity (did, wvm, wvmid, eid, partId, configuration, partMv)
                         -- + Onshape fields (name, partNumber, quantity, material, processes,
                         --   description, onshapeMaterial)
  mesh_key text          -- R2 file holding this state's mesh (may be shared, may be null)
  index (part_id, version_id)

parts (new columns)
  version_row_id → part_versions   -- the state fab should make ("committed pointer")
  committed_at, committed_by

systems (new columns)
  versioning boolean default false -- per system switch, so nothing changes until turned on
  current_version_id → system_versions  -- what the system is pointed at (moves back on Revert)

stored_files             -- byte ledger for R2, filled by putObject
  key pk, bytes int, kind text (studio | part | thumb | file), created_at
```

Derived, never stored (so they can't go out of sync):
- **Latest version** = highest committed `seq`.
- **Part Outdated** = the part's pointer differs from its state in the latest version (a newer row it hasn't taken, or, after a revert, an older state than the latest). Parts that are the same in both versions stay Up to date. "Missed update" = the oldest newer version that changed it.
- **System Outdated** = any part Outdated, or `current_version_id` ≠ latest.
- **Changes waiting** = a `draft` version exists (detected in Onshape, nobody committed yet).

Why one draft per system: detection runs often (panel open, cron, button). It overwrites the single draft instead of piling up rows, so nothing grows until someone commits.

Turning versioning on for a system creates **v0 Baseline**: a snapshot of every current part with its existing mesh (reused from the robot model files where they exist, zero Onshape calls).

## 4. Change detection against the Manufacture assembly

Runs from the API route `POST /api/systems/[id]/changes`, never during page render. In steps, like the 3D build, so a big system fits under Vercel's 60 s (the browser calls again until done):

1. **Did anything move?** `currentmicroversion` of the Manufacture document (1 call). Same as today; stops here if unchanged.
2. **BOM** (1 call) → `planMerge` against the **latest version's state** (not against the BOM rows), giving added / removed / property changes, and per part the new reference.
3. **Subassembly swapped?** If a source's version id changed (V12 → V13), read that document's versions list (1 call) for the name; it becomes the draft's default name ("V13 – shorter arm").
4. **Which geometry really changed?** (Property changes from step 2 are always listed too, geometry or not.) For each Part Studio whose reference moved, the parts list (1 call per Part Studio, already used for thumbnails) gives each part's `microversionId`. Same id = only the reference moved, not the part: the pointer advances silently and the part is **not** listed. Different = "modified".
5. **Meshes for the After side** are exported lazily when a part box is expanded (1 call per part, kept in R2), and for every not-yet-exported part at commit time (with a progress bar).

Cost: an unchanged system costs 1 call per check; a typical subassembly bump with 20 Part Studios costs ~23 calls plus 1 per changed part. Under the 2,200/day budget.

Triggers:
- **Onshape panel open** → system page with `?check=1` → runs detection (skipped if checked in the last 2 minutes) → opens the Commit window if anything changed.
- **Update System button** (system page, Edit mode) → same route, same window; replaces "Update BOM from Onshape" on versioned systems.
- **Background refresh** (existing cron) → detection only. Versioned systems never get changes applied in the background.

Property changes (material, processes, quantity, part number, name, description set in Onshape) are gated like geometry: they wait for a commit and appear in the Commit window's changed parts list (Harel, 2026-10-23).

Not versioned: manual parts (no Onshape source); app-only fields (status, counters, notes, files, groups) as today.

## 5. Meshes and storage (Supabase Free + R2 Free)

Limits: R2 10 GB storage, 1M writes and 10M reads a month, free downloads. Supabase 500 MB database.

- **Database**: a version row ~0.5 KB, a part snapshot ~1 KB. 10 systems × 60 commits × 30 changed parts ≈ 18 MB. Fine for years; shown on the storage window anyway (`pg_database_size`).
- **R2**: per-part meshes are typically 20–300 KB gzipped. A version stores only the parts it changed, and reuses the robot model's Part Studio file when that exact revision is already in R2 (the viewer already extracts one part from a studio file). Estimate 1–5 MB per commit → a season of heavy use is ~0.5–1 GB. The bigger unknown is what is already in the bucket, since old studio files are never deleted today.
- **Byte ledger**: `putObject` records size in `stored_files`; a one-time backfill lists the bucket (1 list call per 1,000 objects). The dashboard reads the sum from the database, no R2 calls.
- **Thresholds** (`src/config/storage.ts`): warn at **6 GB**, auto clean-up above **8 GB** down to 7 GB.
- **Auto clean-up order**: unreferenced files first (old robot model studio files nothing points to), then version previews oldest first. It never touches: the latest 3 versions per system, any version a part currently points at, named versions (custom name typed by a member, as opposed to the default), or the current robot model.
- **"Delete version"** (manual) removes only its previews and marks it "preview removed". The row and its Onshape references stay, so Revert to it still works and history stays readable. A true delete is offered only for versions nothing points at and nothing later depends on.
- **Garbage collector** (in the nightly cron): a mesh file is deleted when no kept version, no part pointer, no draft and no robot model references it.

## 6. Commit, selective commit, revert

All in one transaction each; every one writes `part_history` rows (via `sync`) with `batch_id = version.id`, so Recent Actions, Undo and the AI logs see them like any other change.

- **Commit all**: draft → committed (seq = next, name, by, at). Every listed part's pointer moves to its new row; added parts are inserted, removed parts get `removed_from_cad_at` (data kept, as today); identity and Onshape fields are written to `parts`. `current_version_id` = this version.
- **Selective commit (one part)**: the draft is committed as a version too (with the same name field), but only that part's pointer moves. The other parts in it become **Outdated** with that version as their missed update. A second per-part click in the same window adds to the same version, not a new one. This keeps "one Onshape change = one version" and makes "Update" on an Outdated part instant (no Onshape call, the state is already stored).
- **Update one Outdated part**: move its pointer to the latest row for it.
- **Revert system to version N**: every part's pointer goes to its state at N (its newest row with seq ≤ N); parts added after N are hidden, parts removed after N come back. `current_version_id` = N. **No new version is created**, so the newer version stays at the top, shown green ("Latest, reverted from"). Only the parts whose state differs between N and the latest version get Outdated (Harel, 2026-10-23); the rest stay Up to date. App data (status, notes, fab counters) is never touched. Undoing a revert = revert to the version it came from.
- **Detection after a revert or partial commit** compares Onshape to the latest version, not to the pointers, so Outdated parts are not reported again as "new changes".

## 7. UI flows (Orbit palette; Edit-only actions hidden in View)

**Commit window** (Dialog, wide). Header: "Manufacture assembly changed · V12 → V13 · 3 modified, 1 added, 1 removed". Name input (prefilled) + main **Commit changes** (Electric Blue, `active:scale-[0.98]`). Below, one collapsible box per part: thumbnail, name, part number (mono), a change chip (Modified sky / Added green / Removed red / Properties gold) and the property diffs as `old → new` pills (`[6061 → 7075]` `[Laser → CNC]`). Parts with only property changes are in the same list, with a gold Properties chip and no 3D viewers. Expanded: **Before → After** viewers side by side (single viewer for added/removed), plus **Commit this part**. Only one box expanded at a time, so the page never holds more than 2 WebGL views (browsers cap them around 16). View mode shows the window read-only with an "Switch to Edit to commit" note.

**Part tags** (PartCard Row 2, beside the Status pill and Notes button, no new row):
- Up to date: a small quiet pill (check + `v7`, muted sky). Click → popover "Updated 21 Oct 14:02 by Noa · v7 *Shorter arm*".
- Outdated: red pill. Click → popover with last update date, the missed update (date + name, clickable → opens that version's Commit-style window next to the popover; the popover stays open) and **Update** (Edit mode).
- Not shown on manual parts or on systems with versioning off.

**Versions window** (system page header button, both modes). Collapsible version boxes newest first: `v8 · Shorter arm · 22 Oct · Noa · 3 / 1 / 1`. "Current" chip on `current_version_id`; the latest one green when the system is reverted. Expanded: the same part boxes as the Commit window (shared component). Edit mode adds **Revert to this version** (confirm dialog listing how many parts move) and, from the storage window, Delete.

**Outdated system tag**: a small red Outdated pill on the system's tile in the right side panel (the robot/systems panel, `RobotSwitcher` → `SystemTile`), plus the system page header. Click → the system page with its Versions window open (`?versions=1`). The tile's data comes from the shell's robot list, so the Outdated flag is one extra column in that query (no Onshape call).

**Dashboard Sync box**: the QA cell splits in two equal halves (QA left, Sync right), same card style. Sync shows a sky check and "All systems up to date", or a red count "2 systems outdated" plus a gold line "1 has changes waiting". Click → dialog listing those systems with the reason (reverted / 4 parts outdated / changes waiting in Onshape); each row links to the system page.

**Storage warning box**: only above 6 GB, Solar Gold, above Recent Actions: "R2 storage 6.4 / 10 GB". Click → dialog: systems as collapsible boxes, each version with its size (mono, tabular) and Delete (Edit mode); a bar with the total and the auto clean-up line.

**Recent Actions**: version commits and reverts appear as their own boxes tinted light blue (sky-400/10, sky border) with "System update · Intake · v8". Each action box gets a Revert button (Edit mode) — see §8.

## 8. Recent Actions revert and Undo/Redo without state conflicts

One rule for everything: **an undo is a new forward change, never a rewind of history.** Concretely:

- Part edits already record `old → new` per field. "Configuration changes" are the part edits an action holds (material, processes, type, status, name, qty, notes…), confirmed by Harel. Reverting an action = `planUndo` over that visit's rows (today it works per batch; add a per-visit variant). A field that someone changed again afterwards is skipped and listed ("Status on 2 parts was changed later by Ido, left as is"). This is the existing conflict rule from `undo_batch`, so the UI, MCP and Undo all agree.
- A System Update action's revert = Revert to the version before it (pointer move), plus restoring Onshape fields from the snapshots. The same skip rule applies to fields a member overrode by hand after the commit.
- Inventory stock moves already carry `batch_id`; reverting adds a counter-move.

**Undo / Redo (realistic scope)**: two buttons in the top bar and Ctrl+Z / Ctrl+Shift+Z (ignored while typing in a field).
- A per-tab stack (sessionStorage, last 30 entries) of **my own** actions: `{ kind: part-batch | stock-batch | version-commit | revert | pointer-update, id, label }`. Each server action returns its batch id, which the client pushes.
- Undo calls the same revert as Recent Actions and pushes the resulting batch to the Redo stack; Redo reverts that batch. A toast says what was undone and what was skipped.
- Tracked: status, counters, material/process/type/name/qty/notes edits, bulk edit, To Review approve/reject, COTS fields, stock +/-, commits, reverts, Outdated → Update.
- Not tracked (they get confirm dialogs instead): deleting parts/systems/robots/files (R2 deletes can't come back), pushing names to Onshape, member and invite admin, other members' and AI changes (those stay revertable from Recent Actions and AI logs).
- No client-side optimistic history: the server is the only source of truth, so two open tabs can't fight. Worst case an undo skips a field and says so.

## 9. Improvements I'd suggest

1. **Name from Onshape**: prefill the version name with the Onshape version name of the inserted subassembly; most commits then need zero typing.
2. **Props-only changes** (material/process/qty, no geometry) are listed with a gold "Properties" chip and no 3D viewers, so the window stays short.
3. **Up to date stays quiet, Outdated is loud**: a green tag on 200 cards is noise; the quiet pill keeps the card layout rules and makes red stand out.
4. **Fab safety**: an Outdated part shows a small red dot on To Fab and its download button exports the **committed** reference (exact geometry fab agreed on). Optional later: a warning before marking an Outdated part "done".
5. **Turn on per system** (`systems.versioning`), so it can be tried on one subsystem before the season.
6. **Later, not in scope now**: a ghost overlay diff (Before translucent over After in one viewer); the robot 3D view drawn from committed parts instead of the live assembly.

## 10. Build rounds (by priority; each round is one small branch)

| Round | What | Migration |
|---|---|---|
| 1 | Schema, versioning switch, v0 baseline, detection route + draft, Commit window (list, names, property diffs, Commit all), background refresh stops applying, Update System button, panel `?check=1`. **Spike first**: confirm part `microversionId` stays the same across Onshape versions for unchanged parts, on a real Manufacture doc. | yes |
| 2 | Before → After previews (lazy per-part meshes, reuse studio files), selective commit, Up to date / Outdated tags + popovers, Update one part | no |
| 3 | Versions window, Revert, Outdated tag on right-panel system tiles, dashboard Sync box | no |
| 4 | Byte ledger + backfill, GC in nightly cron, storage warning box + window, auto clean-up, Delete version | yes (`stored_files`) |
| 5 | Recent Actions: System Update boxes (light blue) and Revert on every action | no |
| 6 | Global Undo / Redo | no |

Rounds 1–3 are the core feature; 4 matters only once storage grows (the warning can't trigger for months); 5–6 are independent and can wait.

## 11. Risks

- **Part microversion across versions** (round 1 spike). If Onshape gives an unchanged part a new `microversionId` in a new version, every part looks modified. Fallback: compare a hash of the part's mesh (costs 1 export per part in moved Part Studios) or the part's mass properties (1 call per Part Studio).
- **Re-keyed parts**: if a CAD change gives a part a new partId, the diff shows Removed + Added. The existing re-link-by-name rule turns that into Modified; it carries over.
- **Configured parts / derived parts / mirrored instances** in the Manufacture assembly: identity includes the configuration; test on a real system.
- **Members who expect live sync**: on a versioned system the BOM no longer follows Onshape by itself. The "changes waiting" badge on Update System and the Sync box make that visible.
- **WebGL limits on phones**: one expanded part at a time; previews load only on expand.
- **Existing R2 size is unknown** until the backfill runs (old studio files were never deleted).

## 12. Decisions and open questions

Decided by Harel (2026-10-23):
1. Recent Actions "configuration changes" = the part edits an action holds (material, processes, type, status…).
2. The system's Outdated tag goes on its tile in the **right side panel** (robot/systems panel).
3. After a revert, only parts that actually differ between the two versions get Outdated.
4. Property changes from Onshape also wait for a commit, and are shown in the changed parts list.

Still open (defaults used if Harel doesn't say):
5. **Who can commit and revert**: default any member in Edit mode, like everything else today.
6. **Turn versioning on for all systems at once, or system by system**: default a per-system switch in system settings (Edit mode), so one subsystem can try it first.
