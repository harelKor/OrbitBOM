# Sheet metal flattening: plan

Status: built 2026-10-21 on branch `claude/project-thread-qzi3ty` (no migration), waiting for the combined PR. Not yet tested against a real Onshape sheet metal part. Bent plates use the same plate materials as flat ones (Harel).

## What Harel asked for

Many parts are bent sheet metal plates (like the aluminum angle in the screenshot). We want OrbitBOM to:

1. Notice that a part is sheet metal.
2. Offer a download of its **flat pattern** (what the laser or HadasaS actually cuts).
3. Let the AI setup treat it as a **plate** of the right thickness, not as a block.
4. Keep the part's normal (folded) thumbnail and 3D view.

## Why this matters today

The screenshot shows the problem. The angle is folded, so its bounding box is about 19 x 19 x L mm. The plate rule in `src/lib/review/rules.ts` (`plateFor`) only calls a part flat when its smallest side is under 25% of the middle one, so the angle fails. The AI then read "19 mm" as stock thickness and suggested Aluminum Block on CNC. The real answer is something like 2mm 6061-T6, Laser then Bending.

## What Onshape gives us

| Need | Onshape API | Confidence |
|---|---|---|
| Know a part is sheet metal | `GET /parts/d/{did}/{wvm}/{wvmid}/e/{eid}?includeFlatParts=true` returns an extra body per sheet metal part with `isFlattenedBody: true` and `unflattenedPartId` (the folded part's id). | High (forum, confirmed by Onshape staff) |
| Flat pattern size and thickness | The flat body is a normal part, so it can be tessellated or bounding-boxed like any part. Its smallest side is the sheet thickness; the other two are the blank size. | High |
| Flat DXF | `POST /partstudios/{studio}/translations` with `formatName: "DXF"` on the flat body. Same start, poll, download flow we already use for STEP in `src/lib/onshape/export.ts`. Forum reports say the export is keyed on the flat body's `deterministicId` from the insertables endpoint (`includeFlattenedBodies=true`), not on the part id, and that non-sheet-metal parts return 4xx. Extra flags like `sheetMetalFlat`, `includeBendCenterlines`, `version` exist but are poorly documented. | Medium, needs a spike |
| Flat STEP / Parasolid | Same translation call with `STEP` and the flat body id. | Medium |
| Detection without the parts list | FeatureScript eval endpoint with `qActiveSheetMetalFilter`. Not needed if the parts list works. | Fallback only |

There is **no** Onshape API that flattens a part that was not modelled as sheet metal. A bent shape made with plain extrudes is just a solid to Onshape.

## Two kinds of "sheet metal" parts

**A. Modelled as Sheet Metal in Onshape.** Onshape already knows the flat pattern, bend allowance and K-factor. We only read it. This is the path we build.

**B. A plain solid that looks bent** (extruded L, for example). We should not try to unfold meshes ourselves: it is unreliable and gets bend allowance wrong, which ruins the cut size. Instead:

- Detect it cheaply: a thin wall has thickness ≈ 2 × volume ÷ surface area. We already have every part's mesh in R2 from the 3D model build, so this costs zero Onshape calls. If that thickness matches a plate in `src/config/materials.ts` and the part is not sheet metal, flag it.
- The flag on To Review says "Looks like bent sheet. Make it Sheet Metal in Onshape to get a flat pattern." The material rule can still pick the right plate (the thickness is correct) so AI setup stops saying "block".
- The designer converts it in Onshape (Sheet Metal Model → Convert). Caveat: converting can give the part a new id, so the next Update BOM may see it as a new part. We should test this in the spike; the existing "removed from CAD" and merge flow may cover it.

**"Finish sheet metal" (asked 2026-10-21).** Our understanding is that Finish turns the part into a plain solid and drops its flat pattern, so a finished part falls under B: right plate thickness from the thin-wall check, but no auto DXF. The spike should confirm this. Workaround: keep plates as active sheet metal (cuts and holes work without Finish), or only Finish in a separate configuration.

## How it fits OrbitBOM

All of this follows the house rules: Onshape only on the server, never during page render, every result cached by part revision, $0 hosting.

### 1. Detection (zero extra calls)

- `src/lib/onshape/thumbnails.ts` already calls `parts/{path}?withThumbnails=true` once per Part Studio. Add `includeFlatParts=true` to that same call.
- For each body with `isFlattenedBody`, store on the folded part's `parts.geometry` (jsonb, so **no migration**): `sheetMetal: { flatPartId, flatBbox?, thickness? }`.
- Flat bodies must be ignored everywhere else: thumbnails, 3D model matching, BOM. The BOM comes from the assembly BOM, which never lists flat bodies, so only the thumbnail loop needs a filter.
- Flat size and thickness: when the 3D model mesh for that studio is built, include the flat body's mesh, or measure it with one bounding-box call the first time. Prefer the mesh route (no new calls) if the tessellation answer includes flat bodies; the spike decides.

### 2. AI and rules (To Review)

- `rules.ts`: if `geometry.sheetMetal` (or the thin-wall test in B) gives a thickness, pick the plate by that thickness instead of the bbox. Process default for sheet metal goes in `src/config/autoSetup.ts`, e.g. cut on Laser (or HadasaS), then `bending` as process 2. Harel picks the defaults.
- MCP (`src/lib/mcp/tools.ts`, `parts_to_set_up` / `get_part` / `find_parts`): expose `sheet_metal: true`, `thickness_mm`, `flat_size_mm`, and a `sheet_metal` filter, so the member's Claude reasons from the flat pattern.
- The reason text on the review card says so plainly: "Sheet metal, 2 mm thick, flat 180 x 60 mm: 2mm 6061-T6, Laser → Bending."

### 3. Download

- Extend `GET /api/parts/[partId]/export` with `format=DXF_FLAT` (and `STEP_FLAT` if the vendor wants it). Same R2 cache keyed by `thumbnailRev`: `exports/{partId}/{rev}.flat.dxf`. A second download costs no Onshape calls.
- Filename: `<part number> <name> (flat 2mm).dxf`, so the thickness travels with the file.
- PartCard download menu (`src/components/bom/PartCard.tsx`, `DownloadMenu`): add "Flat DXF" only for sheet metal parts. The 1-click download button uses the machine's format; in `src/config/machines.ts` add an optional `flatFormat` (e.g. Laser and HadasaS → DXF) so a sheet metal part on Laser downloads its flat DXF in one click.
- Thumbnail, 3D Locate and the robot 3D view keep using the folded part. Nothing changes there.
- Later, optional: a small flat outline preview (DXF → SVG in the browser). Not in v1.

### 4. API budget

Detection: 0 new calls. Thickness: 0 calls if it comes from the mesh, else 1 per studio revision. Flat export: about 3 to 5 calls per download (start, 1 to 3 polls, fetch), once per revision thanks to R2. Well inside 2,500/day per member.

## Build order (when Harel says go)

0. **Spike (½ session, needs one real sheet metal part).** Call the parts list with `includeFlatParts`, try the DXF translation with the flat part id and with the deterministic id, check units (mm), layers (bend lines), and whether tessellation returns flat bodies. Also convert one plain solid to sheet metal and see whether its part id changes. Output: confirmed request bodies.
1. **Detection + rules + MCP fields.** No migration, small diff. Fixes the "Aluminum Block" mistake straight away.
2. **Flat DXF download + machine `flatFormat`.**
3. **Thin-wall hint for plain solids** on To Review.

Each step is its own branch, combined at the end as usual.

## Open questions for Harel

1. Is the angle in the screenshot modelled with Onshape **Sheet Metal**, or as a plain extrude? If most of the team's bent parts are plain extrudes, step 3 matters more and we should also push "use Sheet Metal" as a design rule.
2. What does the cutter want: **DXF** (laser, HadasaS) or a **flat STEP**? Should bend lines be in the DXF (on their own layer) or left out?
3. Default processes for sheet metal: Laser → Bending? HadasaS → Bending? Does aluminum sheet ever go to CNC instead?
4. Are the plate thicknesses in `materials.ts` the sheet stock you bend (1, 1.5, 2, 3 mm), or do you need extra sheet entries (for example steel sheet)?
5. Can I run the spike on one real document? I need a link to a Part Studio with a sheet metal part, opened with a member account that has connected Onshape.

## Spike results for Auto Layout (2026-11-04)

Run with `npm run sheetmetal:spike` (scripts/sheet-metal-spike.ts) on 1690-26-423-09A
(Polycarbonate 3mm, system 400, the only part flagged sheet metal on the live site), with API
keys, about 65 calls in all.

| Check | Result |
|---|---|
| Parts list `includeFlatParts=true` | Works: folded ZGQRD, flat body ZFQRD (`isFlattenedBody`, `unflattenedPartId`). |
| Insertables `includeFlattenedBodies=true` | Lists flat bodies; for this part `deterministicId` = the flat part id (ZFQRD). |
| Tessellating the flat body | Works (1 call): 276.6 × 246.9 × 3 mm, lying on z = 0…3 mm, so `flattenMesh` can use it as is. v10 answers `{ bodies: [...] }` with `{x, y, z}` vertices. |
| Flat body bounding box | `parts/…/partid/{flat}/boundingboxes` works; `partstudios/…/boundingboxes?partId=` ignores the part and gives the whole studio. |
| STEP of the flat body | Works (4 calls): one solid, 3 mm thick. |
| DXF of the flat body | **Fails** every way tried (flat id, `sheetMetalFlat`, the folded id, DXF 2013 + mm). So today's `DXF_FLAT` download (same call) doesn't work either. |
| Flat body into an assembly | **Refused**: "Operation attempted to insert an instance of unknown type during REST assembly operation", placed or plain. The folded part inserts fine. Cross-document inserts also need a saved version ("Linked document references require a version identifier"; a microversion is refused). |
| Part ids across versions | Not stable: the same part is ZGQRD/ZFQRD in the workspace and ZUwOD/ZTwOD in V125. Cache by version, match by the released snapshot's ids. |

A second run (`--import`) confirmed the way around it: `POST translations/d/{did}/w/{wid}`
(multipart, the flat STEP) imports it as a Part Studio whose one part sits exactly where the flat
body sits in its own studio, and that part inserts into an assembly like any other.

Built 2026-11-04 (Harel's go): Auto Layout nests a sheet metal part as its flat body's mesh
(`flatMesh` in src/lib/model/part.ts, 1 call per released revision, kept in R2); its Flat DXF and
the laser Layout DXF are drawn from that mesh; Onshape Layout imports the flat STEP into the
layout's document once per revision and places the imported part (`flatImports` on the batch).
Two scratch documents ("OrbitParts sheet metal spike …") were left in the key owner's Onshape
account.

## Sources

- [Onshape forum: flat parts in the parts list (`includeFlatParts`, `isFlattenedBody`, `unflattenedPartId`)](https://forum.onshape.com/discussion/comment/102420)
- [Onshape forum: exporting flat patterns via API (insertables, deterministicId, DXF translation)](https://forum.onshape.com/discussion/comment/89155)
- [Onshape forum: DXF export via REST API](https://forum.onshape.com/discussion/24791/rest-api-exporting-a-part-to-step-works-but-exporting-to-dxf-does-not)
- [Onshape tech tip: export sheet metal flat view as DXF](https://www.onshape.com/cad-blog/tech-tip-export-sheet-metal-flat-view-as-dxf)
