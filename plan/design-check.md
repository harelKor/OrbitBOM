# Design check (CAD page)

Status: all seven phases built (2026-11-13). Show on an overlap draws it red like Onshape.

## Goal

Review the robot's design from the 3D model the site already has: no Onshape calls, nothing heavy
on the server (it's one small VM). Numbers come from geometry code; AI only explains and writes
them up (later phases).

## How it works

- The CAD page's panel has a **Design check** section (whole robot and an isolated system). The CAD
  Team (`check` capability) presses Run: `src/components/check/runCheck.ts` reads every placed copy
  from the loaded viewer (`SceneTools.checkParts`, `src/components/viewer/checkScene.ts`) and runs
  the maths in `src/lib/check/` on the page's thread, pausing through a MessageChannel (timers are
  held to 1/s in hidden tabs).
- The run is saved for everyone (`design_checks`, newest 3 per robot and model) with the model's
  signature; a newer 3D model shows "run it again". GET `/api/robots/<id>/design-check` loads it
  with the limits, each part's material facts, weights set by hand and pairs marked fine.
- Each finding shows its parts (Isolate with ghosts, framed) and can become a comment, prefilled,
  pinned at the overlap.

## Checks (phase 1)

- **Weight** (`weight.ts`, `density.ts`): mesh volume × density from the part's Onshape material or
  inventory material name. Printed parts (a print machine in their processes) count 60% solid. No
  material known: counted as aluminium and listed under "Weight unknown". A weight set by hand
  (`part_weights`, by BOM key, so a COTS part keeps it everywhere) wins. Totals per system against
  budgets; systems ticked in Limits (bumpers) are left out.
- **Frame perimeter and height** (`envelope.ts`): plan-view convex hull along the up axis. With a
  frame zone set, only what's that low above the floor makes the perimeter and parts reaching past
  it are listed; without, the whole robot. Smallest rectangle for length × width.
- **Interference** (`clash.ts`): box sweep for candidate pairs, then the two BVHs (`bvhcast`). A
  triangle pair counts when each goes through the other's plane by more than the export's accuracy
  (0.05 mm on flat faces, 0.6 mm between round ones: chordTolerance is 0.5 mm) and they share a
  stretch of the planes' meeting line (edges meeting at a point are touching, not overlapping).
  Faces on one plane facing the same way with ≥ 1 mm² in common are an overlap too (side by side).
  Screws, inserts, gears, belts by name are listed apart as "usually fine". "It's fine" saves the
  pair (`design_check_ignores`) and it isn't checked again.

Limits per robot (`robots.check_limits`, Edit mode): weight, perimeter, height, frame zone, up axis,
left-out systems, per-system budgets.

Try it on `/dev/viewer` (the panel runs on the sandbox robot with sample data, nothing saved;
`window.designCheck()` in the console). The big sandbox (`?big=1`, 5,460 parts) takes ~15 s.

## Phases 2-7 (Harel's list, 2026-11-13; built the same day)

Every check below gives `DesignFinding`s (`types.ts`: kind, parts, plain text, level warn/info, a
point in model mm, places); the panel lists them by kind with Show (parts isolated, the rest
ghosted, a red dot), Comment and It's fine (saved by finding id in `design_check_ignores`).
Round features come from each mesh's topology (`features.ts`: cylinders merged across Onshape's
half faces; hole vs shaft by facet normal); the run waits for topology after the meshes load.

2. Connections (`connections.ts`): touching pairs within 1 mm (`closestPointToGeometry`); groups
   not touching the biggest group are "not attached"; holes in touching parts parallel and 0.15 mm
   to 0.8 r apart; screws by name (shaft = longest outer cylinder, head = a wider coaxial one):
   holes on their axis classed by diameter ratio (< 0.72 too small, 0.72-0.97 tapped, > 1.2 loose
   unless the head fits in it), thread engagement under 0.8 d, too short for a nut, sticking out
   over max(15 mm, 3 d); parts that only one screw (or rivet) joins, round parts excepted.
3. Access (`access.ts`): five rays from each head out along the axis (< 12 mm no room, < 40 mm
   L-key only); six sideways rays round each nut for a wrench.
4. Plates (`plates.ts`): a plate is its biggest flat face plus the parallel ones within 13 mm,
   outline at least 5× the thickness; its loops in 2D mm. Solid metal plates over 150 cm² (< 8%
   removed), webs under max(1.5 t, 2.5 mm), material beside holes (bolt holes: their radius, at
   least 2 mm; bores over Ø12: 3 mm), sharp inside corners on parts made on the `cnc` router.
5. Printed parts (`printed.ts`): printed flat on the biggest flat face; walls under 1.2 mm from
   400 inward rays, over 8% overhang area, holes lying sideways, PLA with a bore of Ø16 or more.
6. Plate stress (`stress.ts`, `StressDialog.tsx`): the picked plate on a grid of up to 4,000
   squares (Q4 plane stress, Jacobi CG); tapped holes are bolted (edge fixed) or loaded (a pin's
   bearing load); von Mises map and safety factor against yield. Checked against a cantilever.
7. AI (`ai.ts`, Gemini free tier through `geminiJson` in src/lib/recognize/gemini.ts): "Suggest
   with AI" in the stress window guesses bolted holes and the load from the plate's name and
   holes; "Write it up with AI" turns a run into a summary for mentors and a likely fix per finding,
   saved with the run (`results.ai`), added to comments made from it. Names and numbers only, no
   pictures. MCP: `get_design_check` gives members' Claude the newest run.
