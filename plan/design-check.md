# Design check (CAD page)

Status: phase 1 built (2026-11-13): weight, frame perimeter and height, interference.

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

## Next phases (Harel's list, 2026-11-13)

2. Connections: unattached parts, misaligned holes, bolt vs hole size, bolt length, shaft vs bore,
   one-bolt joints. Mates from the assembly read Update 3D model already makes
   (`includeMateFeatures=true`, same call).
3. Assembly access: rays along each bolt axis for a key or driver, room for a wrench.
4. Plates: lightening (material removed, thinnest web, meat round holes, router corner radius) and
   simple strength rules.
5. 3D-printed parts: thin walls, print direction vs loaded holes and tabs, overhangs, material.
6. Plate stress: 2D in-plane stress in the browser, loads suggested by AI.
7. AI write-up of findings into draft comments; MCP tools so members' Claude can run a review.
