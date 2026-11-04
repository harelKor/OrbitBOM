# Automatic fabrication drawings: plan

Status: built 2026-10-21 (steps 0-5), PR #30. Not yet tested live in the app. Thread "Automatic drawings plan".

## Goal (Harel, 2026-10-21)

Shop students manufacture from these drawings. They are made by our own code from Onshape's 3D data, not by Onshape's drawing feature. ISO style. Very simple: minimum information, nothing like Onshape's drawing editor.

House rules still apply: $0 hosting (Vercel Hobby, Supabase Free, R2), Onshape only on the server and never while a page renders, every Onshape answer cached by part revision.

## Harel's drawing standards

Reference example from Harel: `plan/screens/drawing-example-plate.png` (front view with centre marks on holes, side view with thickness "4", an isometric view, one fit callout with a leader).

**Everywhere**
- ISO: first-angle projection, mm, ISO line types (thick visible, thin dimension lines, thin chain centre lines).
- **No hole positions or diameters** (Harel, 17:22). Holes are drawn with centre marks only. We only specify taps and fits.
- **Taps**: every Ø4.2 hole is noted **"M5 tapped"** (match 4.15 to 4.25 mm), grouped when several: "4× M5 tapped".
- **Fits**, to a bearing or to another part: a hole whose Ø matches a stored bearing size gets a fit note with a leader, written like the example: "light press fit for / 1/2IN HEX Bearing / Ø28.7".
- Every other hole gets nothing, unless the user adds a note in the editor.
- Views like the example: front view, side view with thickness (or profile size), small isometric view.
- The BOM block sits at the bottom right of every drawing.

**Stored bearing sizes** (`src/config/drawings.ts`, fixed list, no settings UI)

| Hole Ø | Bearing |
|---|---|
| 28.7 | 1/2IN HEX |
| 22.35 | 3/8IN HEX |
| 16.1 | 8x16x5 Radial |

Fit types: light press, heavy press, slip, precise slip. An automatic match uses "light press" by default (assumption), changeable per hole. Match tolerance ±0.05 mm.

**Plates**
- Thickness.
- Tap and fit notes.
- Max drill (tool) diameter at the smallest inner corner radius, e.g. "Max tool Ø6 (min inner R3)". That is 2 × the smallest concave corner radius, so the router operator knows the biggest end mill that fits.

**Square tubes**
- Outer size X / Y and length Z.
- Wall thickness.
- Tap and fit notes.
- Max tool diameter at the smallest inner radius (for slots and pockets cut in the tube).
- One extra view per tube face that has holes, only when needed (a tube drilled on one face gets one view; drilled through two faces, two views).

**Shafts** (hex and similar)
- Inner hole (bore) diameter.
- Size across flats.
- Length.

**Round tubes**
- OD, wall thickness, ID, length.

Any part that is none of these (blocks, 3D prints, COTS) gets no drawing in v1. The "Create drawings" list greys them out.

## How the data is read (approach B from v1, unchanged)

The 3D meshes we already store in R2 are only ±0.5 mm accurate and turn holes into polygons, so they can't tell 4.2 from 4.3. Instead, for each Part Studio revision, the server asks Onshape for the exact geometry once:

- `bodydetails`: every face with its surface type (plane, cylinder with axis and exact radius) and every edge (line, circle). Holes are cylinders with exact diameters; inner corner radii are concave partial cylinders.
- `tessellatededges`: each edge as a polyline, for drawing curves.

About 2 calls per Part Studio revision, cached in R2 (`brep/{studio}/{rev}.json.gz`), shared by every part in that studio. OpenCascade and the mesh approach stay as a fallback, not v1.

**Part type**: from the part's material first (`src/config/materials.ts` already separates plates, tubes and shafts), checked against the geometry (square tube = 4 outer + 4 inner planes along one axis; round tube = coaxial outer and inner cylinders; hex shaft = 6 planes along one axis). If the two disagree, the part card says "Can't make a drawing: check the material".

## Flow in the app

1. **Create** (system page, Edit mode, next to Bulk edit): a "Drawings" button turns on selection, with "Select all". The selected parts are sent to `POST /api/systems/[id]/drawings`, which runs in steps like the 3D model build (browser calls again until done). It fetches any missing B-rep, classifies each part, and saves an automatic drawing for it. Nothing here runs during page render.
2. **Download**: the PartCard's 1-click download menu gets **Drawing PNG** and **Drawing PDF** when the part has a drawing. Both are rendered in the browser from the saved drawing (SVG → canvas → PNG; PDF with `pdf-lib`), so this costs no server time and no Onshape calls.
3. **Edit**: a small drawing icon button on the card's bottom row, next to the Notes icon (glows when a drawing exists). It opens a window showing the drawing with:
   - every automatic callout and note listed and editable one by one (change the text, hide it, drag it);
   - click any hole to add a note to it: a **fit** (pick the fit type, then a stored bearing, another BOM part to fit to, or a typed size) or a **custom note**. The note is written in the example's format: "<fit> fit for / <bearing or part> / Ø<hole>";
   - "Add note": free text placed "on air" at a click point with an optional leader, not attached to geometry. That keeps the code small;
   - Save. Nothing else: no views to add, no dimension tools.
4. **Out of date**: when Update BOM sees a new part revision, the card shows "Drawing out of date". Re-creating it rebuilds the automatic parts and keeps the manual notes where they were.

**BOM block** (bottom right, filled at render time so it's never stale): part number, name, material, thickness/stock, process 1 → 2, quantity, system and robot, Onshape revision, drawing date, "made by" designer.

## Storage

New table `part_drawings` (migration): `part_id`, `rev` (Onshape revision it was made from), `kind` (plate, square tube, shaft, round tube), `auto` jsonb (views, dimensions, callouts made by the engine), `edits` jsonb (hidden or changed auto items, added notes and callouts), `updated_by`, `updated_at`. PNG/PDF files are not stored; they're rendered on demand.

## Code layout

- `src/lib/drawing/` pure TypeScript, unit-tested on fixtures from the spike, runs on server and in the browser: `classify.ts`, `views.ts` (project edges, depth test for hidden lines), `dimension.ts` (the standards above, one function per part type), `render.ts` (drawing → SVG, ISO line styles, BOM block).
- `src/lib/onshape/brep.ts`: fetch and cache `bodydetails` + `tessellatededges`.
- `src/config/drawings.ts`: the fixed rules (4.2 → "M5 tapped", tolerance, sheet size, fonts), per the "fixed lists live in config" rule.
- UI: `src/components/drawing/DrawingEditor.tsx`, selection mode on the system page, two entries in the download menu.

## AI tools: yes, and cheap

The engine is pure TypeScript on the server, so the existing MCP server can expose it. Members' own Claude accounts do the reasoning, so it stays $0 like part setup.

- `get_part_geometry(part_id)` (read): part type, sizes, holes (Ø, count, which are M5 or match a bearing), smallest inner radius. Lets Claude inspect a part without Onshape open.
- `get_drawing(part_id)` (read): the drawing's callouts and notes, plus a PNG so Claude can look at it (rendered on the server with `resvg-wasm`, about 2 MB, fine on Vercel).
- `create_drawings(part_ids)` and `edit_drawing(part_id, changes)` (write): preview first, apply with `confirm_token`, `undo_batch` reverts, logged in AI logs like every other write tool.

Examples: "make drawings for every plate in Intake", "add 'deburr all edges' to all square tube drawings", "check that every M5 hole on the arm plates lines up with the tube holes". The last one is where AI adds real value: reviewing drawings, not just making them.

## Spike results (2026-10-21, Harel's test document on orbit1690)

Read through Harel's logged-in Onshape tab (read-only GETs, v10). Raw answers (12 JSON files) are on Harel's PC at `Downloads\orbitbom-drawing-fixtures.zip`; they become the engine's fixtures once uploaded.

**Every number came out exact:**
- Plate: Ø4.2 (M5) ✓, Ø28.7 (1/2IN HEX fit) ✓, 3× R3.5 pocket corners (→ max tool Ø7) ✓, thickness 6.7, outline 154.05 × 89.72.
- Square tube: 20 × 50 ✓, wall 1.5, length 100, plus two cross holes Ø5.2 and Ø5.414. Sharp outer corners.
- Hex shaft: 12.70 across flats ✓, Ø4.2 bore ✓ (→ M5 tapped), length 50.
- Round tube: OD 20 ✓, ID 17, wall 1.5 ✓, length 100.

**Answer shapes the engine must handle:**
- `bodydetails`: `{ bodies: [{ id, type: "SOLID", properties{name, material}, faces[], edges[], vertices[] }] }`, metres. Types upper case (`PLANE`, `CYLINDER`, `LINE`, `CIRCLE`).
- Face: `{ id, area, orientation, box{minCorner,maxCorner}, surface{type, origin, normal | axis, radius}, loops[{isOuter, coedges[{edgeId, orientation}]}] }`. **`orientation: false` = concave** (holes, inner walls, inner corners); outer cylinders are `true`. That is the hole / boss / corner test.
- Cylinder `origin` is any point on the axis (can lie outside the part), so position comes from `face.box`.
- Edge: `{ id, vertices[], curve{type, origin, direction | normal, radius}, geometry{startPoint, endPoint, midPoint, length, arcSweep} }`. Full circles have no vertices.
- `tessellatededges`: `{ bodies: [{ id, edges: [{ id, vertices: [...] }] }] }`, edge ids match bodydetails; points come as **segment pairs** (p0 p1 p1 p2 …), dedupe to a polyline. A full circle is 72 segments.
- Bodies also carry the part's material name, useful for classification.

## Build order (when Harel says go)

0. **Spike (½ session)**: `bodydetails` + `tessellatededges` on one plate, one square tube, one hex shaft, one round tube. Save the answers as fixtures. Confirms holes and inner radii come out exact.
1. **Engine on fixtures**: plates first (three views, thickness, centre marks, M5 and bearing fit notes, max tool Ø, BOM block) → SVG.
2. **Create flow + storage**: system page selection, API step job, `part_drawings` migration, PNG/PDF download.
3. **Square tubes, shafts, round tubes**.
4. **Editor window**.
5. **MCP tools**.

Each step on its own branch, combined at the end as usual.

## Assumptions to confirm

1. An automatic bearing match defaults to "light press" fit; the user changes it per hole in the editor.
2. "Create drawings" sits in Edit mode on the system page, since making drawings is a designer action. Download and viewing stay in View mode.
3. "Fit to another part" means picking a part from this robot's BOM (e.g. "slip fit for Intake Shaft / Ø12.7"); it is not read from Onshape mates.
4. Only Ø4.2 is a tap for now. Other taps (M3 at 2.5, M4 at 3.3, 10-32 at 4.0) can be added to `config/drawings.ts` later.
