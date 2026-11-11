# Update BOM / Update CAD, and fewer Onshape calls (plan, 2026-11-11)

Harel's ask (2026-11-11): the CAD version tree starts at the first sync; the panel's Update system
splits into Update BOM (makes a "V.. BOM release" Onshape version) and Update CAD (optional
version, else a sub-version); and syncing one system (sync + Update system + Update 3D) took about
300 calls out of the team's 10,000 a year: find where they go and cut them.

Built 2026-11-11 after Harel's answers (section 6). What changed from the plan:
- Update BOM has an "Update the 3D views and pictures too" checkbox (on by default). Off: only the
  BOM and the export files move (sheet metal, body types), and no 3D export calls are spent. The
  3D model follows whichever of Update CAD or Update BOM-with-3D came last (`systems.model_ref`).
- Pictures are drawn from the meshes; a part's picture is named by a hash of its own mesh, so a
  sibling's edit in the same Part Studio doesn't redraw it or mark its drawing out of date. The
  first redraw after this change carries drawings and fab locks over to the new name.
- BOM release versions go in both documents when there's a Manufacture document. A single
  part's commit (from an Outdated tag) makes no Onshape version.
- Sub-versions are "V12 v1".
- Step 8 (colours without the extra call) is covered by the shared parts list; no spike.

## 1. Where the calls go today

Example: one system, 60 parts in 15 Part Studios, on a robot with 5 linked systems. Counts are
read from the code (there is no per-call log yet, see step 0); they add up to the ~300 seen.

| Flow | Calls | What |
|---|---|---|
| **First sync** (panel Link → `syncSystem`) | ~5 | 1 microversion or versions list, 1 BOM, ~3 version names (1 per linked document version) |
| then thumbnails (`refreshThumbnails`, after) | **~79** | 15 parts lists (1 per Part Studio) + **60 images (1 per part)** + 4 assembly pictures (system and robot: size info + image each, every time) |
| **Update system** (check) | ~17–30 | 1 microversion, 1 BOM, then **mass properties for every Part Studio** (the first sync skipped fingerprints, so the next check makes all of them; workspace Part Studios are re-fingerprinted on every check) |
| Commit | 1 | renames the Onshape version (`syncOnshapeVersionName`) |
| then thumbnails again | ~22 | **all 15 parts lists again** (not just the changed Part Studios) + changed images + the 4 assembly pictures again |
| then the 3D model rebuilds by itself (`afterPartsUpdate` → `MODEL_STALE_EVENT`) | ~20–50 | the **whole robot**: 1 microversion per workspace doc, **1 assembly definition per system (all 5)**, 1 element list per document context, 1 tessellation per changed Part Studio, + 1 parts list per Part Studio whose bodies came without a colour |
| **Update 3D model** (button) | ~48 | same as above, first time for this system's 15 Part Studios (15 tessellations + up to 15 parts lists for colours) |

The big ones, in order: part thumbnail images (1 call per part), the robot-wide 3D rebuild that
runs after every commit, Part Studio parts lists fetched twice by two features, mass properties
for every Part Studio, and the assembly pictures re-downloaded on every sync.

Reading old document versions is **not** a real cost: the whole version list is 1 call however
long it is. Hiding the old versions (feature A) is a display change; it saves nothing.

## 2. The features

### A. The CAD version tree starts at the first sync

`buildTree` (`src/lib/reviews/tree.ts`) gets a `since` time: the system's first BOM version
(the baseline, seq 0, or the first committed one). Onshape versions made before it are left out,
except the one the first BOM was read at, which becomes the tree's root. `loadSystemReview` passes
it. No migration, no calls.

### B. Update system → a window with two big buttons

The panel's Update system tile (`src/app/onshape/panel/UpdateTile.tsx`) opens a window with
**Update BOM** and **Update CAD** (big, side by side, stacked at phone width).

**Update BOM**: the check and Commit window as today. On commit, instead of renaming a version,
a new Onshape version is made of the assembly's document at the exact microversion the check
read (so it's the state that was reviewed), named `V<next> BOM release` (`V<next>` = the highest
`V<n>` in the document's version list + 1). The commit's `onshapeRef.vid` points at it, so the
tree shows the BOM mark on it. Same call count as today's rename (1). The new version is added to
the kept version list from Onshape's answer, so the tree doesn't need a re-read.

**Update CAD**: refreshes this system's part of the 3D model (what the CAD page shows) and adds
a node to the CAD version tree. A **Create version** checkbox:
- ticked: makes an Onshape version (name typed, default `V<next>`) and the model is read at it;
  it is a normal node in the tree.
- not ticked: no Onshape version. The update is pinned to the workspace's microversion and shown
  as a **sub-version** of the newest Onshape version: `V12 V1`, then `V12 V2`… In the tree it is a
  smaller branch hanging off V12. Once a newer Onshape version exists, the branch folds into V12:
  shown when V12 is expanded (the way I read "shows when the version is collapsed"; see decisions).

Data: a new table `cad_updates` (migration 0082, RLS on): system, document, parent Onshape
version id, microversion, own Onshape version id (when one was made), label, member, time.
`buildTree` hangs sub-versions under their parent node (`subs[]`); `VersionTree.tsx` draws the
branch. The 3D model reads a system at its newest CAD update (`v/<id>` or `m/<microversion>`;
both never change, so their Part Studio lists are kept and files reused).

Comments written in the panel on the workspace go on the newest sub-version when there is one.

## 3. Cutting the calls

**Step 0: measure.** The client already counts calls; it also counts them per endpoint kind
(BOM, mass properties, parts list, thumbnail image, tessellation, assembly definition,
versions…) and each flow logs one line at the end (`journalctl -u orbitparts`), and the result
messages show the breakdown. No table. Then every step below is checked against real numbers.

1. **Part thumbnails without Onshape (biggest: 1 call per part).** The 3D export already has every
   part's mesh. After an Update CAD, the member's browser draws each new or changed part from its
   mesh (same camera and lighting for all) and uploads the picture to R2, like the 3D views
   already do. 0 calls per part instead of 1. Parts not in the 3D model yet (Update CAD never run)
   keep Onshape's picture as now. See decision 2: the pictures will look like our 3D view, not
   Onshape's render.
2. **One parts list per Part Studio revision, shared.** Thumbnails (`withThumbnails=true`, sheet
   metal, body type) and the 3D model's colours (`withThumbnails=false`) read the same endpoint
   separately. One read per Part Studio revision, kept in `onshape_cache`, used by both.
3. **Only the Part Studios that changed.** After a commit, thumbnails/parts lists only for Part
   Studios with added or reshaped parts (the draft knows which), not all of them.
4. **Fingerprints only where the geometry changed.** One element list per document (1 call) gives
   every Part Studio's revision; a Part Studio whose revision is the one stored at the last commit
   can't have changed shape, so it gets no mass-properties call. Workspace systems go from 1 call
   per Part Studio per check to 1 per document + the changed ones. The revision is stored per
   part at commit.
5. **Assembly pictures only when the assembly changed.** Keep the microversion the picture was
   taken at; skip when it's the same. Ask for the fixed-size image directly (1 call, not 2). The
   robot's picture is taken on Update CAD of the robot, not on every system sync.
6. **No 3D rebuild after Update BOM.** The 3D model follows Update CAD only (decision 1), so a BOM
   commit no longer rebuilds the whole robot.
7. **Rebuild only the system that changed.** The model is planned per group (system assembly):
   each group keeps its own placements and revision; Update CAD on one system reads that one
   assembly definition and its own document contexts, not all five. The microversion the check
   just read is passed in instead of read again.
8. **Colours without the extra call** (spike first): check whether Onshape's tessellation leaves a
   body's colour out only when it has the default appearance. If so, use the default colour and
   drop the call; if not, step 2's shared list covers it.
9. **Version list reads.** Versions this app makes are added to the kept list from Onshape's
   answer; the panel's 2-minute re-read becomes "only when the panel is open on a version the list
   doesn't know".

## 4. Expected calls after (same example)

| Flow | Today | After |
|---|---|---|
| First sync (BOM + its 3D + thumbnails) | ~84 + ~48 | ~5 BOM + ~18 3D (1 definition, 1–2 element lists, 15 tessellations) + 0 pictures + 1 assembly picture ≈ **25** |
| Update BOM after a small edit (2 Part Studios changed) | ~45–55 + robot rebuild | 1 microversion + 1 BOM + 1–2 element lists + 2 mass properties + 1 version + 2 parts lists ≈ **9** |
| Update CAD after the same edit | ~48 (whole robot) | 1 definition + 1–2 element lists + 2 tessellations + 0–1 version ≈ **5** |

So one system's full round goes from ~300 to roughly 40. If Onshape's own part pictures are kept
(decision 2 = no), add 1 call per new or changed part.

## 5. Order

1. Step 0 (per-endpoint counts) and feature A: small, no migration.
2. Calls 3, 4, 5, 9: no UI change.
3. Feature B (window, BOM release version, Update CAD, sub-versions; migration 0082) with calls 6
   and 7, since Update CAD is where the 3D rebuild moves.
4. Calls 2 and 8, then 1 (browser-drawn thumbnails), last since it changes how pictures look.

Each step: `npm run test:db` (existing tests for detect, thumbnails, budget, tree), test on
`/dev/viewer` for 3D, and compare the logged counts with the table above on a real system.

## 6. Decisions for Harel

1. **3D model follows Update CAD only?** Today every BOM commit rebuilds the 3D. Proposed: BOM
   pages and the CAD page both show the system at its newest Update CAD; Update BOM doesn't touch
   the 3D. (First sync does both.)
2. **Part pictures drawn from our 3D mesh** instead of Onshape's render (saves 1 call per part,
   the biggest single cut)? They'd look like the 3D viewer: same colours, plain background.
3. **Which document gets the "BOM release" version** when the assembly is in a Manufacture
   document that inserts the CAD document by version: the Manufacture document (the one the panel
   is open in, proposed) or the CAD document?
4. **Sub-version name and folding**: `V12 V1`, `V12 V2` as written; and the branch stays open
   until the next Onshape version, then folds under V12 (expand V12 to see it). Right reading?
5. **Systems that follow Onshape versions**: with Update BOM making its own version, following
   the newest version becomes the same thing. Keep the setting, or drop it for panel updates?
