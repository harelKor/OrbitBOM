# OrbitBOM redesign plan (reviewed Argon spec, 2026-10-20)

Source: Harel's Argon spec (thread "Redesign plan review"). FRCBOM UI fidelity rule lifted by Harel.
Kept: `computeStatus`, microversion-gated sync, no Onshape calls during render, server-only Drizzle, $0 hosting.
Code checked: main @ 719c668. Status: Phase A in PR #7. To Review stays a placeholder: Harel will later add AI auto-classification whose changes wait there for designer approval.

## Conflicts with the real code (need Harel's call)

1. **To Review has nothing to review.** No AI classification exists: `parts.class_guess` / `class_source` are never set by sync (only "manual" from inventory). Default: Phase B shows "To Review" as parts with no Process 1 set, or no material (things a designer still has to fill in). AI classification would be a separate feature.
2. **3D robot viewer doesn't exist.** Real viewer = export the main assembly as glTF (Onshape translation, several calls, large file), cache it in R2 per microversion, render with three.js. Doable at $0, but it is its own feature. Phase B builds only the container + legend + "locate" drawer state, as the spec says; the locate button stays disabled until the viewer exists.
3. **Batch download costs API calls.** Each uncached part export = ~3–5 Onshape calls (start translation, poll, download) and up to 50 s on Vercel. Exports are already cached in R2 per part revision, so repeats are free. Default: the browser downloads each part one after another through the existing `/api/parts/[id]/export` route (no server zip, no timeout risk). A 20-part batch uncached ≈ 60–100 calls of the 2,500/day budget.
4. **"Date" filter has no field.** Deadline is being removed from the UI. Default: Date = "last modified" (today / this week / older), using `parts.last_modified_at`.
5. **Status names don't match the spec.** There is no "In Process" status. Default: "In Process" = Build In Queue, In Process 1, Ready for Process 2, Post Processing; "Ready to Fab" = Ready to Fab. A part belongs to a process box if that machine is its pre-process, Process 1 or Process 2.
6. **Pages the spec forgets:** Members (invites/approvals) and Profile (Connect Onshape, MCP tokens) must stay. Default: small links at the bottom of the left sidebar.
7. **View/Edit is UI only, not a permission.** Anyone can flip to Edit; server actions keep checking membership. Saved per browser (cookie).
8. **Robot/system thumbnails are never filled.** `robots.thumbnail_path` / `systems.thumbnail_path` exist but nothing writes them. Default: Phase A uses the first part thumbnail of each system/robot (no extra Onshape calls); a real assembly thumbnail can be added to Update BOM later (1 call per system).
9. **Orbit accent colour:** container can't open 1690orbit.com. Default: one blue accent token; Harel gives the hex to swap in.
10. **Phone:** 3 columns don't fit. Default: below ~1024 px both sidebars become slide-over drawers.
11. Not mentioned by the spec, kept as-is: Table/Kanban views (moved behind Edit mode), Merge parts, part files, Inventory screens (restyled only), the Onshape side panel.

## Phase A: shell, sidebars, Home hub, View/Edit (1 PR)

1. Design tokens in `globals.css` (surfaces, 1px borders, text, accent, light thumbnail well); replace indigo; Button/Pill/Card/Segmented primitives in `src/components/ui/`.
2. New `(app)/layout.tsx`: left nav (Home, Robot Dashboard, To Fab ▸ machines, To Review, Inventory; Members/Profile at bottom), right robot + system switcher (server-loaded, thumbnails from R2), sticky top bar.
3. Top bar: search + Material / Process / Date pills, stored in URL params and carried by every nav link; View | Edit segmented toggle in a cookie, read through a small client context.
4. Home `/` = tiles (BOM, Inventory). Robot list moves to the right sidebar.
5. Remove My Parts and the Part Groups page + nav; hide Deadline, Designer, Description everywhere (columns stay in the DB, no migration).
6. Gate delete / Update BOM / manual part / bulk edit / property editors behind Edit mode.

## Phase B: thumbnail part cards + robot dashboard (1 PR)

1. Rewrite `PartCard` as a square card: thumbnail ~65% on a light well, qty badge top-left, Download (format from machine's CAD format, menu for the others) + locate button top-right; footer with name/number, status pill (1 click opens menu; uses `applyStatus`), notes icon, Material / P1 / P2 pills (popovers only in Edit).
2. Responsive grid in `BomView`; search/filters from the top bar apply to it.
3. `/robots/[robotId]` dashboard: robot-wide part grid with search, To Review + To Fab count tiles, status % bar and per-process % bar from `lib/stats.ts` (only non-zero rows), 3D viewer placeholder panel + legend + locate drawer.
4. Stub `/robots/[robotId]/review` with the default rule from conflict 1.

## Phase C: To Fab page + FAB batches (1 PR)

1. `/robots/[robotId]/fab`: machine boxes with counts; default list = In Process, divider, Ready to Fab; `?machine=` adds a third section with other statuses.
2. FAB toggle: tap cards to select (selected outline), selection held in client state so search/filter changes keep it; ✓ creates the batch.
3. Batches stored in the existing `part_groups` + `group_members` tables (robot-scoped, name auto "FAB 1…", no migration): batch status reuses `set_group_status`'s path (`applyPartChanges`, one undoable history batch); un-batch deletes the member row; a batch whose parts are all done drops off To Fab. Existing Part Groups simply show up as batches.
4. Batch card: thumbnail collage (up to 4), shared status pill, batch download (sequential per part, see conflict 3), expand to the member cards.
