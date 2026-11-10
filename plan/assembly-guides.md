# Assembly page (plan v2, 2026-11-10; shipped the same day)

Built: `src/app/(app)/robots/[robotId]/assembly/`, `src/components/assembly/`, `src/lib/assembly/`,
`src/lib/data/assembly.ts`, migration 0079. `/dev/assembly` shows it on the 3D sandbox's robot.
Harel's answers: sub-assembly 2 is ignored; tens digit 0 = loose system parts; any member with a
team ticks; the branches are a vertical tree with lines, like the version tree. Then (same day):
the editor's part list became a search over the whole system with pictures, COTS included (parts
not placed in 3D join as `id:<part id>`), and MCP got `list_assembly_steps` and
`tick_assembly_steps`. Then: a step may take parts from earlier steps again (search or tap in
3D), and bring whole earlier steps in (`step_refs`, migration 0080), each drawn in one colour.

One **Assembly** page per robot (`/robots/<id>/assembly`, left nav next to CAD). CAD members (and
admins in Edit) write the critical assembly steps; everyone ticks steps off as they build, and the
progress is kept. Build members don't edit steps. No "Ask CAD" (Harel, 2026-11-10).

Ground rules: no Onshape calls while viewing or authoring (everything comes from the model files and
BOM we already keep), no new cloud resources, phone-first.

## 1. Sub-assemblies come from the part number

There are no Onshape sub-assemblies inside a system's assembly; the part number carries them
(Harel, 2026-11-10): `1690-26-421-01` = team-year, then `421` = system **4**00, sub-assembly1
4**2**0, sub-assembly2 42**1**, then the part `01`.

- A part's **sub-assembly** = its system + the first two digits of the 3-digit segment (`42`).
  Parsed with the same code regex `drawingMatch.ts` already uses (`PART_CODE_RE`), from
  `partNumber`, then the name; the team prefix doesn't matter (1691 works too).
- Tens digit `0` (`401-03`): the part sits directly in the system, no sub-assembly.
- Parts with no code (most COTS hardware): not in any sub-assembly. They show neutral in 3D and
  join a step only when CAD adds them to it.
- Sub-assembly2 (the last digit) is not its own group; see open question 1.
- A sub-assembly is named `Sub-assembly 420` until CAD gives it a name ("Roller arm"), saved once
  per system + code.
- Groups are recomputed from the BOM every time, so a new sub-assembly in CAD just appears.

## 2. The page

One route; where you are lives in the URL (`?at=<systemId>` or `?at=<systemId>:42`), so Back,
reload and shared links work.

### 2a. Robot level (the eagle eye, default)

```
┌──────────────────────────── robot 3D ─────────────────────────────┐
│  [Assembly ●] [Status] [CAD]   ← Assembly is the default here     │
│  each sub-assembly in its own colour; hover → whole group lights  │
│  up + its name; click → that sub-assembly's page                  │
└───────────────────────────────────────────────────────────────────┘
┌ Drivetrain 3/8 ┐┌ Intake 1/6 ────┐┌ Arm 0/9 ───────┐┌ Climber ┐ …
│ 1 Frame rails ✓││ 1 Side plates ✓││ 1 Pivot tube   ││ …       │
│ 2 ▣ Gearbox L  ││ 2 ▣ Roller arm ││ 2 ▣ Wrist      ││         │
│   (sub, 2/4)   ││   (sub, 0/5)   ││   (sub, 0/7)   ││         │
│ 3 Belly pan    ││ 3 Mount to DT  ││ …              ││         │
└────────────────┘└────────────────┘└────────────────┘└─────────┘
```

- **Assembly view** is a new colour mode of the robot viewer: one distinct colour per
  sub-assembly (stable per code, so 420 is always the same colour), loose parts neutral grey.
  Hover lights up the whole group and shows its name; tapping a part opens its sub-assembly.
  Finished sub-assemblies get a small ✓ tint, so the 3D shows how far the robot is.
- Below it, **one column per system** (robot's system order) with its steps in order. A step is
  either a normal step or a **sub-assembly step** (▣): a card standing for a whole sub-assembly,
  with its own steps and progress (`2/4`); it counts as done when all its steps are.
- Columns are compact cards (title, small still image, ✓). On phones the columns swipe sideways.

### 2b. Focused (a system or a sub-assembly)

Tapping a system column, or a ▣ step inside one, makes it the **main column**:

```
┌───────────── 3D of this system / sub-assembly ─────────────┐ ┌ Branches ──────────┐
└────────────────────────────────────────────────────────────┘ │ Robot              │
 ▸ Finished (3)                        ← closed by default      │ ├ Drivetrain 3/8   │
 ┌ Step 4  Shaft through, spacers in order        [ ] done ┐  │ │ └ Gearbox L 2/4  │
 │  live 3D of this step's parts │ text                     │  │ ├ Intake 1/6  ◀ you │
 └──────────────────────────────────────────────────────────┘  │ │ └ Roller arm 0/5 │
 ┌ Step 5  Mount arm to pivot                     [ ] done ┐  │ └ Arm 0/9          │
 │  …                                                       │  │   └ Wrist 0/7      │
 └──────────────────────────────────────────────────────────┘  └────────────────────┘
                                          [↑ Back to step 4]  ← pops up when scrolled past
```

- **Branch panel** on the right: the tree Robot → systems → their sub-assemblies, each with
  progress, your place clearly marked (highlighted row + ◀). Tap any row to jump; "Robot" goes
  back to the eagle eye. Entering a sub-assembly from a system column adds it under that system
  in the tree. On phones the panel is a breadcrumb bar at the top (`Robot › Intake › Roller arm`)
  that opens the tree as a sheet.
- The **3D on top** shows the focused system or sub-assembly (the rest of the robot hidden).
- **Steps are slides scrolling down**: each slide = a 3D view of that step's parts + its text.
- **Done checkbox** on every step. Ticked steps stay where they are while you're on the page;
  when you come back they're in a **Finished** section at the top, closed by default.
- **Back to step N** arrow pops up when you've scrolled away from the first unfinished step
  (the one after the last finished), and scrolls back to it.
- The page opens at the first unfinished step.
- In a system column, a ▣ slide shows the sub-assembly's 3D, its progress and an "Open" button
  that moves into it.

### 2c. What a step shows

- Its **parts**: by default the step's own parts in colour and the parts from earlier steps of the
  same column ghosted, so you see where the new parts go (LEGO-style). Later steps' parts hidden.
- Its **camera** (saved by CAD), still rotatable; "Reset view" puts it back.
- **Text**, and a ⚠ **Critical** flag that turns the slide's header red.
- A short **parts list** with quantities from the BOM (tap → part window).
- One WebGL viewer per slide would be too heavy on phones: the slide nearest the middle of the
  screen gets the live 3D, the others show a still image taken when CAD saved the step (kept on
  R2). It switches as you scroll; the mesh cache (S2) makes it instant.

## 3. Writing steps (CAD + Edit)

In a focused column, CAD sees an **Edit** switch:

- **+ Step** (between any two slides): pick parts in the top 3D (click / box select from S3) or
  from the **Not in a step yet** tray, which lists this column's parts that no step uses yet
  (not every part needs a step, it's just a reminder). Set the camera, type a title and text,
  save. The still image is taken then.
- **+ Sub-assembly step** in a system column: pick one of the system's sub-assemblies. Any
  sub-assembly not placed yet shows at the end of its system column, greyed, for CAD only.
- Edit / re-capture / delete a step; drag slides to reorder; name a sub-assembly.
- Steps whose parts left the BOM (after Update BOM) get a **CAD changed** mark for CAD; the
  missing parts are just left out of the 3D.

## 4. Progress

- A tick is per robot, kept with who and when ("✓ Noa, 12 Nov"). Any member with a team ticks or
  unticks (the `work` capability). Columns, branches and the 3D show the counts.
- Editing a step's text keeps its tick; changing its parts clears it (it's a different step now).

## 5. Data (one migration)

- `assembly_subs`: system_id, code (`"42"`), name. Names only; groups come from part numbers.
- `assembly_steps`: id, system_id, sub_code (null = the system's column), position, kind
  (`step` | `sub`), sub_ref (the code a `sub` step opens), title, body, critical, part_keys text[],
  camera jsonb, image_key, stale, created_by, timestamps.
- `assembly_ticks`: step_id (unique), member_id, done_at.
- All with RLS on. Deleting a step goes through `deleteToTrash`. A new capability `instruct` in
  `mode.ts` (CAD + Edit) for writing; ticking uses `work`. MCP read tools (list the steps and
  progress) so members can ask their Claude "what's left on the intake?".
- Migration number: S6 (viewer plan) also wants 0079; whoever lands second takes the next one.

## 6. Dependencies on the viewer rework

A step saves only its parts and camera, so this doesn't need S6's saved-view format. It uses:
S1 camera (done), S2 mesh cache (done), S3 picking / box select / hover names (done).
The Assembly colour mode goes in `src/components/viewer/paint.ts`, which S9 (display modes) will
also touch: do it as a small, separate mode and tell S9.

## 7. Order

- **A1**: part-number grouping (+ tests), schema, the page with robot level (Assembly colour view,
  hover / click to sub-assembly, system columns), focus mode, branch panel / breadcrumb, URL state.
- **A2**: step slides (live-in-the-middle 3D + stills), ticking, Finished section, Back-to-step
  arrow, open-at-first-unfinished.
- **A3**: editor (+ Step, + Sub-assembly step, Not in a step yet tray, reorder, names), CAD
  changed marks, MCP read tools.

A1 + A2 can be checked with steps seeded locally; A3 makes it usable by CAD. Ship together, or A3
right after A2.

