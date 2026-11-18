# Motion along the mates, rigid groups (S8 of plan/cad-3d-viewer.md)

Status: built 2026-11-18 (M1–M4), checked on `/dev/viewer` (carriage slide with limits, arm on the moved carriage, typed angle). Not yet checked on a real robot: after deploy, Update 3D model and read the `model mates` log line (`sudo journalctl -u orbitparts | grep "model mates"`) to confirm Onshape's fields. Changes from the plan: the tree's base is the body with the part fixed in Onshape (occurrence `fixed`; else the first placed), not the biggest; "Move along" and its handle were removed (Harel, 2026-11-18), dragging is the way; Alt-to-move-one-part is a "Move part only" menu item; every level's mates move (the definition doesn't say which sub-assemblies are flexible).

Goal: on every 3D view (CAD page first), parts move the way Onshape's assembly lets them. Drag
an arm and it turns about its revolute mate's axis, at that mate connector. Drag an elevator
carriage and it slides along its slider mate, carrying the arm mounted on it. Parts that are
Grouped or Fastened in Onshape move together, in Move and in the exploded view. All of it runs
in the browser, local only like Move today: never saved to Onshape, "Moved (not in CAD)" while
anything is off its CAD place, Reset puts it back.

## 1. What Onshape gives, and what it costs

The model build already reads each system's assembly definition: one call per system
(`planGroup`, `src/lib/model/build.ts`), today with `includeMateFeatures=false`. With `true`,
the same call also returns `features` for the root assembly and for each sub-assembly:

| featureType | What's in `featureData` | Used for |
|---|---|---|
| `mateGroup` | `occurrences[].occurrence` (instance-id paths) | rigid set |
| `mate`, `mateType: FASTENED` | `matedEntities[2]` | rigid set |
| `mate`, `REVOLUTE` / `SLIDER` / `CYLINDRICAL` / `PIN_SLOT` | `matedEntities[2]`, each `matedOccurrence` (path) + `matedCS` (`origin`, `xAxis`, `yAxis`, `zAxis` in that part's frame) | a joint at its mate connector: turn about the connector's Z, slide along Z (pin slot: turn about Z, slide along X) |
| `mateRelation` (`GEAR`, `RACK_AND_PINION`, `SCREW`, `LINEAR`) | `mates[].featureId`, `relationRatio` / `relationLength`, `reverseDirection` | two joints moving together |
| `mate`, `PLANAR` / `BALL` / `PARALLEL` | | left out (they move freely, and nothing in FRC needs them) |

The connector's place in the assembly is the occurrence's transform (already in the same answer)
× `matedCS`. So the axis sits exactly where the mate connector was put in Onshape: nothing is
guessed from the geometry.

Limits (min / max angle or travel) are **not** in the definition. They come from the assembly's
features list (`GET assemblies/…/features`), 1 call per assembly document element.

Calls:
- Mates, groups, relations: **0 extra calls**. The same call returns a bigger answer.
- Limits: +1 call per assembly element that has a revolute / slider / cylindrical / pin slot mate
  (the definition tells us which ones do first, so assemblies without them cost 0). Only when a
  system's plan is read again, which happens when its document changed (Update 3D model).
- Shipping it: the plan's format changes (`PLAN_VERSION` bump), so each robot's next Update 3D
  model reads every system's plan again once. That's about 2 to 4 calls per system (definition,
  Part Studio revisions, limits). Mesh files are kept in R2 under their revision and are not
  exported again.

Not verified yet: the exact field names above are from Onshape's forum and the
onshape-robotics-toolkit's data model, not from one of our assemblies. Step M1 starts with one
test call on a real system (1 call) and fixes the parser to what comes back.

## 2. How it works

**Server (model build, no extra work in the browser):**
- `flattenAssembly` keeps each placement's occurrence path (today it walks it, then drops it).
- A new `src/lib/model/mates.ts` reads the features of the root and every sub-assembly. A
  sub-assembly's paths are relative to it, so they get each of its instance paths in front; a
  sub-assembly placed twice gives its mates twice. Suppressed features and features that name a
  hidden or suppressed instance are skipped.
- It writes into the model file (`RobotModel` / `ViewerModel`):
  - `bodies`: each placement's rigid set (union of Groups, Fastened mates and, per decision 1,
    sub-assemblies), as an index per placement.
  - `joints`: `{ id, name, type, a: body, b: body, frame: 4×4 in assembly mm, limits? }`, the
    frame taken from side A's connector at the CAD place.
  - `relations`: `{ joints: [i, j], ratio }`.
- Per system only. Mates between systems would be in the robot's main assembly, which the model
  build doesn't read; they stay out (no extra calls).

**Browser (`src/lib/model/kinematics.ts`, pure maths with unit tests; `src/components/viewer/mates.ts`):**
- Bodies are nodes, joints are edges. The base is the body with the most parts in that system
  (the frame or plate). From it, a tree: each joint's far side is everything past it.
- Each joint has a value (degrees or mm), 0 at the CAD place. A body's place = the product of its
  joints' motions from the base, so the arm on the elevator rides up with the carriage and still
  turns about its own axis, wherever the carriage is.
- A closed loop (a four-bar, a belt modelled with mates): the joints in the loop are locked and the
  view says "Linkage: not moved here". Solving loops is Onshape's job.
- Gear / rack relations: the second joint follows at its ratio. A relation that would close a loop
  is ignored the same way.
- Limits: the value is clamped when Onshape has them.
- It writes through `motion.ts`'s place / setPlace, so Reset, the "Moved" chip, Measure, Section,
  Hide and picking keep working on moved parts.

**Using it (copying Onshape's assembly view):**
- Mouse: left-drag a part that has a joint. It turns or slides along that joint, following the
  pointer around the projected axis (turn) or along it (slide). Left-drag is free today (left is
  picking; right orbits, middle pans). A part with no joint keeps today's behaviour.
- Right-click a part: "Move along mate" shows a one-axis triad at the mate connector (a ring for
  turn, an arrow for slide) and a small box with the mate's name, its value (° or mm) and its limits.
  This is also the way on phones, where one finger orbits.
- Move (the free triad) picks up a part's whole rigid set; Alt moves just that part. The menu gets
  "Select group" (the rigid set).
- Exploded view: inside a system, rigid sets spread out as whole units, so a bolted gearbox
  doesn't fly apart part by part.

## 3. Decisions for Harel

1. **Sub-assemblies.** In Onshape, a sub-assembly is rigid in its parent unless it's made Flexible,
   so its mates don't move from the top level. Copying that means an arm inside a non-flexible
   sub-assembly won't turn here either. Recommended: copy Onshape when the definition says which
   instances are flexible (the M1 test call shows whether it does). If it doesn't say, let every
   level's mates move.
2. **Limits.** Read them (+1 call per assembly with moving mates, only when it changed) or move
   without limits (0 calls). Recommended: read them.
3. **Positions in saved views.** Put the joint values in the view state (`viewState.ts`), so a
   comment pin or Named view brings the arm back to where it was when the comment was written
   (0 calls). Recommended: yes, it's what makes "arm at 90°" review comments work.

## 4. Steps

| Step | What | Files |
|---|---|---|
| M1 | Test call on a real system; mates parser; keep occurrence paths; bodies / joints / relations in the model file; limits call; `PLAN_VERSION` bump; tests from a trimmed real answer | `src/lib/model/assembly.ts`, `mates.ts` (new), `build.ts`, `model.test.ts`, `snapshotStore.ts` (old snapshots have no mates: no motion there) |
| M2 | Kinematics: tree, forward places, loops, relations, limits; unit tests | `src/lib/model/kinematics.ts` (new) |
| M3 | Viewer: left-drag along a joint, "Move along mate" one-axis triad + value box, Move by rigid set, Select group, explode by rigid set | `src/components/viewer/mates.ts` (new), `motion.ts`, `ContextMenu.tsx`, `ViewerToolbar.tsx`, `/dev/viewer` sample with mates |
| M4 | Joint values in view state (if decision 3 is yes) | `src/components/viewer/viewState.ts`, `pins.ts` |

One push for M1 to M4 (Actions minutes). Checked on `/dev/viewer` at desktop and phone width with a
sample arm-on-elevator model, then on one real robot after Update 3D model.

## 5. Risks

- Field names or frames not as expected: M1's test call settles it before anything else is built.
- Deep nesting (sub-assemblies of sub-assemblies): the path prefixing handles any depth. If real
  data shows something odd, stop at one level and say so.
- Mates whose connector frames don't coincide at the CAD place (an offset in the mate): the axis
  is taken from side A's connector, so turning stays about the right line. Only the 0 point
  shifts, and it isn't shown as an absolute angle anyway (values are relative to CAD).
