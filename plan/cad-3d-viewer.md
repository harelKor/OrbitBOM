# CAD 3D views vs Onshape assemblies: comparison and improvement plan

Status: live plan (2026-11-10). Unlike the other files in `plan/`, this one is kept up to date
while the work runs: each session ticks its row in "Progress" below when it ships. Covers the 3D
view on the CAD pages
(`ReviewScreen` → `ModelCanvas` + `ViewerToolbar`); the BOM pages' `RobotViewer`, `PartStage` and
the Commit window use the same `ModelCanvas` and get most of it for free.

Ground rules that don't change: viewing never calls Onshape, everything stays free (no paid libs,
no new cloud resources), heavy work stays in the browser, phones are first-class.

## Progress (update this when a session ships)

| Session | What | Wave | State | Commit / notes |
|---|---|---|---|---|
| S0 | Split ModelCanvas + small `/dev/viewer` sandbox | 0 | done (2026-11-10, 636b012) | also `paint.ts`, `types.ts`, `viewer.ts`; proxy lets `/dev/` through outside production |
| S1 | Navigation like Onshape | 1 | done (2026-11-10, 496b45a, 1c0a696, 0fb2be8) | one camera switching ortho/perspective in place; cube only where the page passes `onTools`; no roll arrows |
| S2 | Instant loading | 1 | done (2026-11-10, db01e1c) | cache drops old revisions after 2 days unused, anything after 30 days (not "everything unused"); part windows don't use the cache yet |
| S3 | Context menu, hide / isolate, Shift+Y under the mouse | 1 | done (2026-11-10, 76a3a99, 0b73627, 215e46b, 68e1c17) | Section here, worker topology, nearest-hit raycasts; comments a column beside the 3D view at ≥ 1280 px |
| S4 | Section v2 | 1 | done (2026-11-10, c4b701c) | Include / Exclude per part shape per subsystem; red interference not yet seen on real data |
| R1 | Section view like Onshape (panel, face picks, circular sections, red) | parity | in progress (2026-11-11) | its own session |
| R2 | Menu, isolate without ghosts, no pick pop-up, bigger measure box | parity | in progress (2026-11-11) | the orchestrator session |
| R3 | View cube menu = Onshape's camera and render options; toolbar; part windows; gap pass | parity | after R1 and R2 | |
| S6 | Saved views + comment pins (migration) | 2 | after the parity round | |
| S7 | Explode and move | 2 | waiting for Harel's OK after wave 1 | |
| S9 | Display modes and polish | 2 | waiting for Harel's OK after wave 1 | |
| S8 | Motion along the mates | later | needs its own plan first | |
| ~~S5~~ | ~~Parts list~~ | | dropped (Harel, 2026-11-10) | |

How to pick up: take the first row that is not done and whose wave can start, read its brief in
§4, mark it "in progress (date)" here in the same commit as your first code, and "done (date,
commit)" when it ships. Wave 1 sessions can run at the same time because each owns its own files
(the ownership table in §3); don't edit another session's files. If the code has moved away from
a brief, the code wins: adjust the brief here and say so in your commit.

When an orchestrator session runs the waves (it starts one worker session per step), only the
orchestrator edits this table and the briefs: parallel workers all touching this file would
collide on every rebase. A worker reports its commit and anything the brief got wrong instead.

---

## 1. Where we stand

What `ModelCanvas.tsx` (891 lines, one `useEffect`) does today:

| Area | Ours now | Onshape assembly |
|---|---|---|
| **Rotate** | Left or right drag, OrbitControls about a fixed target (the last Fit centre) | Right drag; rotates about the point where you start on the model |
| **Pan / zoom** | Middle drag; wheel zooms toward the target, not the cursor | Middle drag / Ctrl+right; wheel zooms **at the cursor** |
| **Standard views** | Text buttons Fit, Iso, Front, Top, Side (no back / bottom / left), camera jumps | View cube (click face / edge / corner, ±90° arrows, menu), Shift+1…7, F to fit, arrow keys rotate, animated |
| **Projection** | Perspective only, fixed near plane 5 mm (close-ups clip) | Orthographic by default, perspective optional |
| **Display** | One look: shaded + face borders; Status / Changes colours | Shaded, shaded without edges, hidden edges, translucent; silhouette edges on curved faces |
| **Selection** | Click picks a face / edge / point (always on); the part follows from it; stacked picks; Space drops the last, Esc all | Click select, box select, "select other" (behind), selection filter, right-click context menu |
| **Part list** | None (not planned, Harel 2026-11-10). The panel holds the version tree; hidden parts are a small list | Instances list (tree by subassembly) with eye toggles, search, two-way highlight with the 3D view |
| **Hide / isolate** | Y hides the hovered copy, Shift+Y brings back the **last** (planned: the hidden part under the mouse); popup Hide / Isolate for the picks; Isolate hides all others | Y hide, Shift+Y shows the hidden instances; Isolate; make transparent; display states that persist |
| **Section** | One plane, X / Y / Z only, a 0–1 slider over the whole robot's box, Flip; no caps (you see lit inside faces) | Plane from any face / plane / mate connector, drag manipulator (offset + angle), up to 3 planes, include / exclude parts, interference shown red |
| **Measure** | Close to Onshape already: faces, edges, points, distance, XYZ, angle, hole centres (`measure.ts`) | Same, plus units, mass properties |
| **Moving parts** | None | Drag along the mates' degrees of freedom, Transform triad, exploded views, mate animation |
| **Comments** | On a part (key) or system; no view, no position in 3D | Comments can carry the view / selection |
| **Loading** | Every visit downloads every mesh again (signed R2 links change each time, so the browser cache never hits); nothing draws until all files decoded; decode + edges + topology on the main thread; hover raycasts every triangle | Streams and draws progressively |
| **Phones** | One-finger rotate, pinch, tap picks with wider tolerance, Tools folded | Onshape's app: similar gestures, long-press menu |

Our edge over Onshape: the 3D view sits next to the BOM, status colours, version Changes,
comments with tick / approve, and opens on any phone without an Onshape seat or calls. The plan
leans on that and doesn't try to copy Onshape's modelling side.

## 2. Biggest gains, ranked

1. **Navigation that feels like Onshape**: zoom at the cursor, rotate about the point under the
   cursor, view cube, orthographic, animated views, shortcuts. Used every second; costs little.
2. **Instant loading**: cache the mesh files in the browser (Cache Storage, keyed by the R2 key,
   which already names the Part Studio revision, so a file never changes), draw progressively,
   decode in a worker, BVH raycasting. A phone opening a CAD page a second time goes from a few
   seconds of download to almost nothing.
3. **Context menu and hide / show**: right-click / long-press menu, ghosted isolate, and Shift+Y
   bringing back the hidden part under the mouse.
4. **Section v2**: from a picked face, draggable, in mm, capped, more than one plane.
5. **Views that persist and travel**: the view (camera, hidden, isolated, section) in the URL; a
   comment saves its view and a 3D pin, and opening the comment brings that view back. This is
   where we beat Onshape for mentor reviews on a phone.
6. **Moving parts**: explode slider and a free move triad (local only), then motion along the
   mates later, after its own planning (§5).

## 3. How the sessions are cut

`ModelCanvas` is one 800-line effect; two sessions editing it at once will collide. So:

- **Wave 0 (one session, first, alone)**: split `ModelCanvas` into modules with clear owners and
  add a local 3D sandbox. After that each later session owns its own files.
- **Wave 1 (up to 4 sessions in parallel)**: navigation, loading, selection + menu, section.
- **Wave 2 (after wave 1 lands)**: saved views + comment pins (S6), explode / move (S7), display
  modes and polish (S9).
- **Later**: motion along the mates (S8), after its own planning round.

Each session: commit and push to `main` when done (Harel's flow); `npm run lint`, `typecheck`,
`npm test`; check the `/dev/viewer` sandbox at desktop and phone width (390 px). Only S6 touches
the database (`npm run test:db`). Each brief below can be pasted into a new session as written.

### File ownership after Wave 0

```
src/components/dashboard/ModelCanvas.tsx      thin React shell: props, effects, overlays
src/components/viewer/stage.ts                renderer, scene, lights, render-on-demand, resize   (S1)
src/components/viewer/camera.ts               controls, fit, views, ortho, tweens, view cube API  (S1)
src/components/viewer/load.ts                 fetch / cache / decode / build instanced meshes     (S2)
src/components/viewer/visibility.ts           hide, isolate, ghost, groups, hidden list           (S3)
src/components/viewer/picking.ts              raycast, hover, face/edge/point picks, marks        (S3)
src/components/viewer/section.ts              clipping planes, caps, handle                       (S4)
src/components/viewer/sectionCaps.ts, sectionHandle.ts, sectionMath.ts                        (S4)
src/components/viewer/meshWorker.ts, meshCache.ts                                               (S2)
src/components/viewer/ViewCube.tsx, ContextMenu.tsx                                              (S1, S3)
src/components/viewer/measureLayer.ts         measure state → measure.ts, report                  (S3)
src/components/viewer/motion.ts               explode, move triad, mates                          (S7, S8)
src/components/viewer/viewState.ts            serialise / restore the whole view                  (S6)
src/components/viewer/paint.ts                colours, materials, status / CAD / Locate paint     (S9; others import)
src/components/viewer/viewer.ts               wiring only: creates the modules, joins them        (shared: add your own lines only)
src/components/viewer/types.ts                shared types (meshes array, context)                (shared: add your own lines only)
src/components/review/ViewerToolbar.tsx       toolbar UI                                          (S1, S4: different blocks)
```

---

## 4. The sessions

### S0. Split ModelCanvas + a local 3D sandbox (Wave 0, alone)

Why first: every later session needs a model to look at, and local dev has no Onshape and no R2,
so today no session can see the 3D view locally.

- Move the code out of the one effect into `src/components/viewer/*` as in the table, with no
  behaviour change. `SceneTools` stays the public API (add to it, don't break it). Keep the
  existing comments and their "(Harel, date)" notes with the code they describe.
- A small dev-only page `/dev/viewer` (404 when `NODE_ENV === "production"`) that draws a
  **synthetic robot** built in code: `encodeMeshes` (`src/lib/model/mesh.ts`) writes a handful
  of shapes (a plate with holes, a tube, a round standoff, a see-through polycarb plate) placed a
  few dozen times in 2–3 subsystem groups, served from a dev route, with fake part names. Just
  enough to test picking, section, hide and measure. Keep it small (Harel, 2026-11-10: the
  sandbox should cost little); S2 adds a big variant for its performance check if it needs one.
- Add this to `.claude/launch.json` notes / README "Local development": "3D: open /dev/viewer".
- Done: CAD pages behave exactly as before in production; `/dev/viewer` shows the robot with
  every current tool working; unit tests for the pure pieces (fit maths, section plane maths).

### S1. Navigation like Onshape (Wave 1)

Owns `camera.ts`, `stage.ts`, the views block of `ViewerToolbar.tsx`, a new `ViewCube.tsx`.

- Wheel zooms at the cursor (`OrbitControls.zoomToCursor`); pinch zooms at the pinch centre.
- Rotate about the point under the pointer when a drag starts on the model (raycast on
  pointerdown, move the target there without moving the camera); empty space keeps the centre.
- Orthographic camera, default on, toggle in the cube's menu; Fit and views work in both.
  Near / far planes follow the model size and zoom (no more clipping close up).
- View cube top right of the 3D area (an SVG / small three.js cube that follows the camera):
  click a face / edge / corner, ±90° arrows, menu (Ortho / Perspective, Iso, Dimetric, Fit).
  Move the comment popups below it. On phones the cube is 64 px and tappable.
- Animated view changes (~250 ms ease; instant with `prefers-reduced-motion`).
- Keys (by `e.code`, so a Hebrew layout works, like Y today): F fit, Shift+1…7 front / back /
  left / right / top / bottom / iso (Onshape's set), arrows rotate 15°, Shift+arrows 90°, `?`
  opens a shortcuts sheet. Not while typing or with a window open.
- Done: all of the above in the sandbox, desktop and phone; Fit / views still frame only what's
  shown.

### S2. Instant loading (Wave 1)

Owns `load.ts`, a new `meshWorker.ts`, `robotModel()` in `src/lib/model/build.ts`.

- `robotModel` returns each studio's R2 key next to its signed link; the browser keeps the
  gzipped file in Cache Storage under that key (immutable: it names the revision) and only
  fetches on a miss. Drop entries the current model no longer uses. Wrap all cache access in
  try/catch (private windows).
- Decode, normals, face-border edges and topology in a Web Worker (transferable buffers).
- Draw progressively: add each Part Studio's instances as it arrives, Fit once at the start from
  the placements' positions, keep the % only as a thin bar.
- `three-mesh-bvh` (MIT, free) for hover and picks on the instanced meshes; check bundle size.
- Lower pixel ratio while the camera moves on phones, full when it stops.
- Add a `?big=1` sandbox variant (~5000 instances, same few shapes) for the performance check.
- Done: second visit to a CAD page draws from cache (Network tab: no mesh downloads); hover on
  the `?big=1` sandbox stays smooth; R2 operation count goes down (still well inside the free
  tier, which it already is).

### S3. Selection, context menu, hide / isolate (Wave 1)

Owns `picking.ts`, `visibility.ts`, `measureLayer.ts`, a new `ContextMenu.tsx`, the pick popup in
`ReviewScreen.tsx`.

- Right-click **without** a drag (≤ 4 px, like left click today) opens a menu on what's under it;
  long-press does the same on touch. Items: Hide, Hide others, Isolate, Show all, Make
  transparent / Make opaque, Zoom to, Open part, Open system (robot page), Add comment here,
  Section here (calls S4's API when there; hidden until then), Copy name.
- Isolate keeps the others as see-through ghosts (toggle in the menu: Ghost / Hide others),
  reusing the Locate ghost material.
- Shift+Y shows the hidden part under the mouse (Harel, 2026-11-10): hidden copies are drawn at no
  size today, so the hover raycast also tests the hidden copies at their kept positions
  (`kept` in visibility.ts). The nearest one along the ray comes back, even when a visible part
  is in front of it. While the mouse is over a spot where a hidden part sits, a faint outline of
  it shows, so you can see what Shift+Y will bring back. Nothing hidden there: nothing happens.
  This replaces today's "bring back the last hidden one". The Hidden list stays as the way to
  bring parts back on touch.
- "Select other": Alt+click (or a second click on the same spot) cycles through the parts
  behind the first hit.
- Box select: Shift+left-drag on empty space picks every part inside the box.
- Hover shows the part name in a small label by the pointer after ~400 ms (mouse only).
- Done: all in the sandbox; touch long-press works on a phone; nothing else changes picking.

### S4. Section v2 (Wave 1)

Owns `section.ts` and the section block of `ViewerToolbar.tsx`.

- Section from a picked flat face (its normal and point from `topology.ts`) or X / Y / Z; the
  offset in **mm** from that face or the model centre (number field + slider), Flip.
- A 3D handle (arrow) on the plane to drag the offset, a ring to tilt it (TransformControls or
  our own; on phones a slider stays the main way).
- Up to 3 planes (`clipIntersection` off: each cuts), each with its own row.
- Caps: the cut faces filled (stencil-buffer capping, per part colour darkened), so a section
  reads like Onshape's instead of showing lit inside faces. Overlapping caps of two parts drawn
  red (Onshape's interference hint).
- Section only the picked parts / all but the picked parts (Onshape's Include / Exclude).
- Done: in the sandbox, a plate with holes cut through reads clearly at phone width; the edge
  lines respect every plane (they do today for one).

### The Onshape parity round (Harel, 2026-11-11)

After Wave 1 Harel asked for the tools, logic, UI and look to copy Onshape's, unless he said
otherwise before (kept: hover blue / picked orange, Shift+Y brings back the hidden part under the
mouse, Space drops the newest pick, no parts list). Missing Onshape features are welcome too.
Usage matters: test what the change touches, not everything.

**R1. Section view like Onshape** (owns `section.ts`, `sectionCaps.ts`, `sectionHandle.ts`,
`sectionMath.ts`, the section panel, which moves out of `ViewerToolbar.tsx` into
`src/components/viewer/SectionDialog.tsx`; it may add to `SceneTools` and `picking.ts`'s click
routing only for "clicks go to the section while the panel is open").
- Opens with Shift+X, the right-click menu's "Section view" (on a face: cut there), and the view
  cube menu (R3 wires that to the same `SceneTools` call). A "Section view" panel at the top left
  of the 3D view. While it is open, a click on a flat face adds a plane on it, a click on a round
  face adds a **cylindrical section** on its axis and radius; each adds one, up to 3 (Onshape's
  way), ✕ on a row removes it; clicks don't make measure picks then. With nothing picked: a
  "Default plane" choice Front / Top / Right (replaces X / Y / Z).
- ✓ closes the panel and keeps the cut (measuring works again); double-click a cap reopens it;
  "Turn off section view" (panel, menu, Shift+X) ends it.
- Remove All / Picked / Others (no Include / Exclude either).
- Handle as Onshape's: drag the arrow (depth, or radius on a cylinder), click it to flip, arcs to
  tilt a plane, and a number box in the 3D view by the handle for the exact depth / angle.
- N: view normal to the newest section (or a picked flat face when not sectioning).
- Cylinder: clip by distance to the axis in the shaders (parts, edges, caps), keep inside or
  outside (Flip); caps by the same stencil method with a cylinder surface instead of the quad.
- Red where two solids overlap on a cut, like Onshape: today only different part shapes are
  compared (copies of one shape never), and it hasn't been seen working. Check it on overlapping
  parts in `/dev/viewer` (add two there if needed).

**R2. Menu, isolate, pop-ups** (owns `ContextMenu.tsx`, `visibility.ts`, `ReviewScreen.tsx`).
- Menu: no Hide others, no Zoom to; "Section here" → "Section view" (calls R1's API); View normal
  to (N) on a flat face.
- Isolate shows only the parts, no ghosts; "Show others as ghosts" stays as a second step.
- No pop-up on a pick (the top-left list with Isolate / Hide / Open part / Open system): the menu
  does it. The small "Isolated · Show all" chip stays (phones).
- Measure box bigger (about 20rem, bigger values), bottom right.

**R3. Camera and render options, toolbar, gap pass** (after R1 and R2; owns `ViewCube.tsx`,
`camera.ts`, `ViewerToolbar.tsx`, `PartStage.tsx`, `RobotViewer.tsx`).
- The cube's menu = Onshape's camera and render options: standard views, Dimetric, Trimetric,
  Perspective / Orthographic, Section view / Edit / Turn off; later S9's display modes and S6's
  named views go here.
- Toolbar: no Section button; Fit on phones only, with the colours toggle and the Hidden list.
- Part windows and BOM pages: the cube, and the mesh cache (Wave 1 left them out).
- A last side-by-side pass against Onshape's assembly view; small missing things it finds get
  built (for example "Open in Onshape" from the menu: a plain link, no API call).

### S6. Saved views and comment pins (Wave 2, needs a migration: 0081, the Assembly page took 0079 and 0080)

Owns `viewState.ts`, `src/components/review/Comments.tsx`, `src/lib/reviews/comments.ts`, the
MCP review toolset (`src/lib/mcp/toolsets/cadReview.ts`), schema.

- A view = camera (position, target, ortho, zoom), hidden keys, isolated keys, section planes,
  colours mode. Kept in the URL hash (`#v=…`, compact base64), so reload keeps it and "Copy view
  link" shares it.
- `review_comments.view` jsonb (+ `pin` [x, y, z] in assembly mm, from the face picked when
  writing). Add comment saves the current view and the newest pick's point.
- Pins drawn in 3D as small numbered dots (fixed screen size, like measure points); tap a pin or
  a comment in the list: the view animates back to the one it was written in.
- `add_review_comment` / `list_review_comments` (MCP) carry the pin and view; count in
  `tools.test.ts` unchanged unless a tool is added.
- Done: `npm run test:db`; a comment written on a phone with a section and hidden parts opens on
  a laptop exactly as seen.

### S7. Explode and move (Wave 2, after S3)

Owns `motion.ts` and a Move block in the toolbar.

- Explode slider: subsystems (groups) move out from the robot centre, then parts within each
  from its centre. Pure client, resets with one button.
- Move: a triad (three's TransformControls) on the picked parts to slide / turn them freely,
  for "what's behind this"; Reset positions. Local only: never saved, never sent to Onshape,
  marked "Moved (not in CAD)" while anything is moved. Measure reads the moved positions.
- Done: in the sandbox at phone width; Section, Measure and Hide keep working on moved parts.

### S8. Motion along the mates (later, after its own planning round)

Not part of this plan's waves (Harel, 2026-11-10): it gets its own plan before any code. What's
known so far, as a starting point for that plan:

- The model build already reads each assembly's definition (`build.ts:300`) with
  `includeMateFeatures=false`. Turning it to `true` returns the mates **in the same call** (no
  extra Onshape calls, one bigger answer). Store revolute / slider / cylindrical mates with
  their two mate-connector frames per placement group.
- Drag a part with a revolute mate: it turns about the mate axis with everything mated to it
  (chain by mates, rigid groups by fastened mates); sliders slide. Limits when Onshape has them.
  Arm / elevator / intake positions for reviews, all in the browser.
- Needs a model rebuild per robot (Update 3D model) to take effect. Risky part: subassemblies
  and nested mates; stop at one level if it gets deep.

### S9. Display modes and polish (Wave 2, any time after S0)

- Display menu: Shaded with edges (today), Shaded, Hidden edges visible, Translucent; a soft
  background gradient like Onshape's.
- Silhouette outlines on curved parts (a screen-space edge pass), off on phones if slow.
- Units mm / in for Measure and Section (FRC parts are often inches), kept per browser.
- Copy a measured value with a click.

## 5. Decided (Harel, 2026-11-10)

1. Shift+Y shows the hidden part under the mouse (S3).
2. No parts list (the old S5 is dropped). Finding parts stays with picks, the context menu and
   the Hidden list.
3. Motion along the mates comes later, after its own planning (S8).

4. Go for waves 0–2 (S0, S1–S4, S6, S7, S9); run by an orchestrator session.

## 6. Not in this plan

A parts / instances list; editing CAD, mates or features (Onshape's job); older versions in 3D
(each needs an export: calls); mass properties (no reliable densities); markup drawings on
screenshots.
