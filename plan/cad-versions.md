# CAD page: visit, compare and manage versions (plan, 2026-11-17)

Harel's list (2026-11-17), grouped into phases that each ship on their own. Status: **built
2026-11-17** (all six phases, one commit), decisions at the bottom.

## What shipped (and where it differs from the phases below)

- Snapshots are keyed by state, not by tree node: `model_snapshots.key` = kind | document | element
  | v:version or m:microversion (`src/lib/model/snapshotStore.ts`). Written by every model build
  that plans a group at a fixed state and by Update CAD / Basepart's commit; the state the model
  is on now is taken from the built plan the first time it's asked for (`snapshots.ts` backfill).
  No `cad_updates.changes` column: a version's changes (colours, its CAD Commit window) are worked
  out in the browser from its snapshot and the one before it (`src/lib/versions/versionDiff.ts`,
  meshes compared by `shapeSig`), so old versions get them too.
- Tree nodes carry `ref` (where their model is read); `src/lib/reviews/versionList.ts` lines them
  up and finds "the version before". `GET/POST /api/robots/<id>/model/version` reads or builds.
- The CAD page loads the visited version and the one before it as one model (older under `~` keys,
  hidden while visiting); Compare shows both and `fadeGroups` crossfades them
  (`src/components/review/versionView.tsx`, `ReviewScreen.tsx`, `VersionTree.tsx`).
- Robot versions (`robot_versions`, `src/lib/versions/robotVersions.ts`): the Whole robot fold on
  the CAD page (Final only) with + Create version; each node draws every system's kept snapshot.
  The robot's main assembly got no Update CAD of its own: the 3D model is built from the systems'
  assemblies, so decision 3 and Create version cover the robot.
- Not done: the visited version isn't kept in the address (`?version=`); comments written while
  visiting aren't filed under that version.

## What exists today (why the plan looks like this)

- The tree (`src/lib/reviews/tree.ts`, `src/components/review/VersionTree.tsx`) is Onshape versions
  + BOM versions + CAD sub-versions + comments. A tap only folds a node's comments.
- The 3D model is one plan per robot (`onshape_cache` `robot-model:<id>`): placements + one R2 file
  per Part Studio revision (`models/studios/…`, never deleted). Each system's group is read where
  its `model_ref` pin says. **Nothing keeps an older version's plan**, so an old version can't be
  drawn today without reading Onshape again.
- Update BOM keeps its changes and rows on `system_versions` (`changes`, `rows`), so its Commit
  window can be shown again. Update CAD / Basepart keep **no** changes: the draft is dropped on
  commit (`src/lib/versions/cad.ts`).
- "Changes in X" colours come from the current BOM version's `changes` (`ReviewScreen.tsx`).
- The robot's main assembly (`robots.main_assembly_url`) is only drawn when no system has a Final;
  it has no tree, no Update CAD. Robot comments sit in the "Robot comments" fold
  (`cad-review/CadReview.tsx`). The robot's Basepart already has a tree.
- Onshape can't delete a version (UI or API): "delete" can only remove it from OrbitParts.

## Phase 1: quick UI (no schema)

- 3D right-click menu: remove **Select other** (`viewer/ContextMenu.tsx`; the `cycle` code in
  `measureLayer.ts` / `picking.ts` goes too if nothing else uses it).
- "Changes in V12" → **Changes in last version** (`ReviewScreen.tsx` Segmented label).
- Comment cards: a clearer outline and gap between cards, like Onshape's (`Comments.tsx` card
  class: stronger `border-line`, a little more shadow and spacing, light and dark checked).
- Remove the **◎ View** button. A tap on the card already opens the comment window, which turns the
  view to where it was written; the pin number still does too.
- Threads collapse: a "▸ 3 replies" line folds the whole thread (folded by default in lists, open
  in the comment window).
- Remove the **Robot comments** fold from the left panel (they come back inside the robot's own
  version tree in Phase 6; until then they're in the comments column as now).

## Phase 2: snips and part links on replies

- Migration 0095: `review_comment_replies` gains `snip` (jsonb), `part_key`, `part_name`.
- The reply box gets 📷 Snip (same `Snip.tsx` flow and upload as a comment) and "Link part" (pick in
  3D, like + Add comment). A reply shows its snip picture and a part chip that focuses the part.
  `addReply` / `editReply` / `deleteReply` (deletes its snip from R2) in `src/lib/reviews/comments.ts`.
- MCP: the reply tool takes `partKey` too (`tools.test.ts` count unchanged).

## Phase 3: keep every version's model (the base for 4–6)

- Migration 0096: table `model_versions` (owner system | robot, `kind` final | basepart, the node it
  belongs to: Onshape version id / `cad_updates` id / `system_versions` id, `plan` jsonb = that
  group's placements, studio file keys, part names, sketches; `changes` jsonb; `created_at`). RLS on.
- Written at every commit: Update CAD, Update Basepart, Update BOM with "Update 3D views". `cad_updates`
  gains `changes` (the Commit window's list) so it can be shown again.
- On deploy: each system's current model saved as its current version's snapshot (from the built
  plan, 0 Onshape calls).
- Older versions (before this ships) have no snapshot. Opening one builds it once from Onshape at
  that version (plan read + meshes only for Part Studio revisions not already in R2), with the call
  count shown first; then it's kept. See decision 2.
- Cost: a snapshot is tens of KB of JSON in Postgres (far under the 500 MB); read only when someone
  opens that version (egress tiny). R2 files are shared between versions; only Part Studios that
  changed add files.

## Phase 4: visit a version, its ⋮ menu

- **Tap a version** in the tree: the 3D shows that system at that version (its group swapped for the
  snapshot; other systems as now). The panel marks it "Viewing V9 · Back to current"; the address
  keeps `?version=`. Colours: every part that version changed, like the Changes tab (Shape /
  Properties / Added, Removed listed). New comments written there are filed under that version.
- **⋮ on each version** (right end of its row; on phones a 36 px target):
  - **Commit window**: the window that version was committed with, read-only. BOM versions: the
    existing `CommitWindow` from `system_versions.changes` / rows. CAD / Basepart: `CadCommitWindow`
    from `cad_updates.changes`, before/after previews from the kept R2 files. Older CAD updates with
    nothing kept: worked out from the two snapshots when both exist, else "Not kept for this version".
  - **Compare**: the version being viewed (the current one if none) and the chosen one drawn on top of
    each other. Per part: newer copy green, older yellow; a part that didn't change (same place, same
    mesh) is grey in both. A slider at the bottom fades smoothly: one end the older solid and the
    newer clear, the other end the reverse, the middle both half. Close (or Esc) ends it. Done in the
    browser: the second model is a second set of meshes in the same scene (new
    `src/components/viewer/overlay.ts` on `SceneTools`), parts matched by part key, "changed" =
    transform differs or mesh hash differs (the same hash pictures use). 0 Onshape calls.
  - **Delete version** (admin, with a confirm): see decision 1.

## Phase 5: compare inside the Changes tab

- The tab is "Changes in last version"; in it, the part right-click menu gets **Compare to last
  version** for every picked part (one or many). Those parts' previous-version copies are drawn over
  them with the same colours and slider as Compare; the rest of the model stays as is.

## Phase 6: the whole robot's document gets the same version structure

- The robot's main assembly gets what a system's Final has: Update CAD in the Onshape panel (check
  → Commit window → commit, a new Onshape version or a sub-version), `robots.model_ref` pin
  (migration 0097), its own tree from the document's Onshape versions with sub-versions, the ⋮ menu,
  visit and compare.
- In the left panel a **Whole robot** fold at the top holds that tree, with the robot's comments
  under the versions they were written on (replacing "Robot comments").
- `cad.ts` `ownerLink` / `pinModel` / `listCadUpdates` take a robot owner for the Final as they
  already do for the Basepart; `loadRobotReview` builds the robot's tree like a system's.
- See decision 3 for how a robot version is drawn.

## Order and size

Phase 1 → 2 → 3 → 4 → 5 → 6. Phases 1 and 2 are small and can go first and alone; 3 is the
groundwork; 4 is the biggest (visit + three menu items + the overlay). Tests: tree with delete
marks, snapshot write/read (`*.db.test.ts`), overlay change matching (unit), reply snips. Every
phase tried on `/dev/viewer` and on a phone width.

## Decisions (Harel, 2026-11-17)

1. **Delete version** removes it from OrbitParts only (Onshape can't delete versions), BOM versions
   included: the node, its sub-versions, its saved model and commit record go; its comments move to
   the version before it; an Onshape version is hidden from the tree (`hidden_versions`). A BOM
   version's part rows that the next version doesn't replace move to that next version, so part
   history and Revert stay whole. Deleting the version the BOM is on first reverts to the one before
   it (the same as Revert), then deletes. The very first (only) version can't be deleted.
2. **Versions from before this ships**: opening one builds it once from Onshape (call count shown
   first), then it's kept.
3. **A robot version** shows every system as it was at that moment (each system's kept snapshot), 0
   Onshape calls.
4. **Create version for the whole robot** (added 2026-11-17): a button on the Whole robot section
   that makes an OrbitParts version of the robot ("R1", "R2", with a name and note): it records each
   system's current version and model snapshot at that moment. It's a node in the robot's tree with
   the same ⋮ menu (visit, compare, Commit window = what changed in each system since the last robot
   version, delete). No Onshape version, no calls.
