# CAD page: comment rework and Design Reviews (plan, 2026-11-18)

Harel's request (2026-11-18), in short: a non-blocking Add comment window; comments linked to an
edge / face / point, not just a part; a clearer comments panel (bigger section headers, Esc doesn't
close it, State and DR filters, a "show in 3D" checkbox); comment bubbles with the author's picture
in the 3D view; and Design Reviews (DRs) that admins start and finish, with every comment written
meanwhile tagged to the DR. Status: **plan, waiting for Harel's go**.

## What exists today (why the plan looks like this)

- Page: `src/components/review/ReviewScreen.tsx` (wrapped by `cad-review/CadReview.tsx`). Left
  panel (`<aside>`): back link, the **robot's name line** (`<h1>{title}</h1>`, ~line 543), + Add
  comment, Design check, then `panel()` (CadReview's folds: Whole robot, each system, the version
  tree). Right column: `Popup "Comments"` (Open + On it, grouped by `BySystem` / `SystemSection`)
  and, for mentors / Edit mode, `Popup "To check"`.
- The **3 dots** Harel means: `MoreMenu` (⋯) on each comment row (`Comments.tsx`, `CommentRow`),
  today Edit and Delete.
- Add comment: `AddCommentDialog` in a modal `Dialog` (`showModal`, blurred backdrop). It keeps
  `at = { view, pin }`: the whole 3D view and the newest pick's point in assembly mm
  (`pins.ts` `pickPoint`). The part is a `partKey` (did:eid:partId) + `partName`.
- Part chip: `PartChip` → `showPart` → `locateKey`: the robot turns see-through and the part is
  framed in green (that is the "isolate" Harel doesn't want). Tapping a comment / pin calls
  `viewComment`, which puts back the author's whole view (the "exact view of the user").
- Pins: numbered round dots (`src/components/viewer/pins.ts`), always shown for open comments.
- Esc: the page's handler first **folds the comments column** (Harel 2026-11-11); that goes.
- Picks: `Pick = { m, i, kind: face | edge | point, n }` (`picking.ts`): mesh, copy, and the
  face / edge / corner number in the part's topology, which the browser rebuilds from the part's
  mesh (`src/lib/model/topology.ts`). Those numbers are stable while the part's mesh file is the
  same, **not** across a geometry change. Onshape's own face ids aren't in our meshes.
- Robot versions: `robot_versions` ("R1", "R2"…, `createRobotVersion` in
  `src/lib/versions/robotVersions.ts`): every system's kept snapshot at that moment; drawable in
  the tree. No Onshape calls.
- Comments aren't read through `cached()` (not in `Watched`), so a new table read with them needs
  no `data_versions` triggers.

## 1. The Add comment window (no blur, top left)

- A floating window in the **top-left corner of the 3D view**, no backdrop, no blur: the 3D view
  still turns, zooms and picks while it's open. Built as a non-modal `<dialog>` (`show()`, not
  `showModal()`), so a new `floating` option on `Dialog` (or a small `FloatingWindow` beside it).
  Width ~22 rem; it can be dragged by its title bar. Same fields as today (text, part / anchor,
  Snip, scope on the robot page), Ctrl+Enter saves.
- While it's open, **each new pick in the 3D view becomes its anchor** (see 2): the "Linked to"
  line reads e.g. `Edge · Shooter side plate` with ✕ to drop it. Nothing picked: no anchor, as now.
- Its own Esc closes it only when the text box is empty (a typed comment is never lost to Esc).
- Phones (no room top left): a bottom sheet half the screen high, no backdrop, the 3D view above it
  still usable.

## 2. Comments linked to an edge / face / point

Stored on `review_comments.anchor` (jsonb, null for old comments):

```ts
type Anchor = {
  key: string;            // the part's BOM key (did:eid:partId), as partKey today
  kind: "face" | "edge" | "point";
  n: number;              // its number in the part's topology (picking.ts Pick.n)
  mesh: string;           // the part's mesh file key (R2) it was numbered on
  sig: AnchorSig;         // what it looks like, in the part's own frame (mm), to find it again
  at: [number, number, number]; // its point in assembly mm (= pin), picks the copy and is the fallback
};
// face: kind plane|cylinder|other, normal / axis, point, radius, area
// edge: kind line|circle|other, length, mid point, dir / centre + radius
// point: the corner's position
```

- **Finding it again** (browser, `src/lib/reviews/anchor.ts`, pure and unit-tested): same mesh file
  → `n` as is. Mesh changed (a newer version) → the face / edge / corner of that part whose
  signature is closest (same kind, then distance of normals / radius / mid point), within a
  tolerance. Not found (the part is gone or the feature changed beyond recognition) → the `at`
  point, and the tag says "(moved)". The copy (`i`) is the one nearest `at`.
- **The tag on the comment** still shows the part's name (`PartChip`), with a small face / edge /
  point glyph. A tap: **frames that face / edge / point close up from the current direction**
  (`frameBox` on its box with margin; no turning to the author's view) **and selects it** (orange,
  like a click; a new `selectPick(pk)` on the measure layer). No see-through, no isolate.
- `viewComment` (put back the author's whole view) stays only behind a "Go to the author's view"
  item in ⋮, since Harel doesn't want it on a tap.
- Replies keep their part link only (no anchor), as today.

## 3. The right comments panel

```
┌────────────────────────────────────────────────┐
│ ☑ Comments  12      [State ▾] [DR's ▾]      ›  │  ← taller header (h-12), one line
├────────────────────────────────────────────────┤
│ ▌WHOLE ROBOT                          3        │  ← section header: text-sm/base bold,
│ ┌────────────────────────────────────────────┐ │    accent bar on the left, tinted band
│ │ (img) Noa · 2h        [Open ▾] ⋯           │ │
│ │ ◆ Shooter side plate  DR · R7              │ │  ← part/anchor tag, DR tag
│ │ The bolt here hits the belt.               │ │
│ └────────────────────────────────────────────┘ │
│                                                │  ← clear gap between sections
│ ▌SHOOTER                    Isolate   5        │
│ ┌────────────────────────────────────────────┐ │
│ │ ...                                        │ │
└────────────────────────────────────────────────┘
```

- **Section headers** (`SystemSection`): text-sm → text-base semibold, a 3 px accent bar on the
  left and a light tinted band behind the name, count badge on the right, ~12 px between sections.
  The section's outline goes; the cards inside already have their own borders (one outline, not two).
- **Esc** no longer folds the column (the page's Esc handler loses that step); the › button folds it.
- **Header line**, a bit taller to hold:
  - **☐ checkbox** left of "Comments": shows the comment bubbles in the 3D view (4). Off: none
    shown. Remembered per device (localStorage). Default off.
  - **State ▾**: Open + On it (today's list, default), Open, On it, To check, Done, All. The
    separate "To check" box for mentors stays as it is.
  - **DR's ▾**: "All comments", then each DR newest first: `DR 3 · R7 · 18 Nov` (● when open).
    Hovering (long press on phones) shows a small popup with its State text. Choosing one shows
    only the comments tagged to it (on top of the State filter; the header shows `DR 3 ✕`).
- **Hover a comment** (row, or its 3D bubble): the row gets a light accent tint, its bubble grows
  a little and its anchored face / edge is drawn in hover blue. Leaving takes it off.

## 4. Comment bubbles in the 3D view

Replace the numbered dots (`pins.ts`) with a speech-bubble tag holding the author's picture:

```
   ╭──────╮
   │ (img)│   ← author's avatar (initials when none), border in the status colour
   ╰─╮ ╭──╯
     ╰╯       ← its tail touches the anchor point on the model
```

- Shown only while the checkbox is on, for the comments the panel lists (its filters apply), on
  the model they were written on (Basepart / Final). The anchor's point (2) places it; old
  comments use their pin; comments with neither aren't drawn.
- A tap opens a **comment-shaped popup** next to it (HTML over the canvas, moved each frame like
  the pins): author, time, status pill, the text and the snip thumbnail (tap = big), Reply / Open
  links; its tail points at the anchored edge / face / point. **The view doesn't move.** A tap
  elsewhere or ✕ closes it; only one open at a time.
- Bubbles that overlap on screen are nudged apart (simple screen-space spacing), tails still
  pointing at their points.

## 5. Design Reviews (DRs)

### UI

- **Start DR** button, admins only (`member.isAdmin`), on the right of the robot's name line in
  the left panel. Opens a centred window:

```
┌ Start a Design Review ───────────────────┐
│ Systems included                          │
│  (•) Whole robot   ( ) Choose systems     │
│      ☐ Drivetrain ☐ Shooter ☐ Intake ...  │
│ State                                     │
│ ┌───────────────────────────────────────┐ │
│ │ What's being reviewed and where it's  │ │
│ │ at…                                   │ │
│ └───────────────────────────────────────┘ │
│                     [Cancel] [Start DR]   │
└───────────────────────────────────────────┘
```

- Once started the button reads **Finish DR** (asks to confirm: "Finish DR 3? 14 comments are
  tagged to it."). While a DR is open, the left panel gets a soft **Orbit-blue glow in its bottom
  left corner** (a radial gradient from the corner, fading out within ~10 rem; CSS only, under the
  content, `pointer-events: none`), seen by everyone on the page, not just admins.
- Every comment added while it's open is tagged `DR · R7` (R7: the robot version made at Start,
  see below). A tap on the tag: a small popup with the DR's State text, who started it and when,
  its systems, and Finished … when it's done.
- ⋮ on a comment: **Add to DR…** (a short list of the robot's DRs) or **Remove from DR** when it
  has one.

### Rules

- Only admins start or finish a DR (`requireAdmin` in the server actions; MCP tools need admin).
- One open DR per robot (a partial unique index; Start when one is open says so).
- A comment written while a DR is open is linked to it **if it's in its scope**: a whole-robot DR
  takes every comment; a systems DR takes comments on those systems and on the whole robot. Done
  on the server in `addComment` (and the MCP), not trusted from the browser.
- ⋮ Add to DR / Remove: the comment's author or an admin. A comment is in at most one DR.
- Finishing a DR doesn't touch its comments' statuses; they stay tagged and filterable.

### "The robot version at the DR"

Start DR **creates a new robot version** (`createRobotVersion`, named `R<n>`, its note = the DR's
State text), so the DR points at exactly what was on the screen when it began and the tree can
draw it. Same rule as Create version: no Onshape calls; it fails ("no system's 3D model is on a
fixed version yet") only when nothing has been committed, and then Start DR says so. If that
version is later deleted, the DR keeps its label (`version_label`) and the tag still reads `R7`.

## Data model: migration `0097_design_reviews.sql` (expand only)

```sql
CREATE TABLE "design_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "robot_id" uuid NOT NULL REFERENCES "robots"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,                                  -- DR 1, DR 2… per robot
  "whole_robot" boolean NOT NULL DEFAULT true,
  "system_ids" jsonb NOT NULL DEFAULT '[]',                -- when not whole robot
  "state" text NOT NULL,                                   -- the State text
  "robot_version_id" uuid REFERENCES "robot_versions"("id") ON DELETE SET NULL,
  "version_label" text,                                    -- "R7", kept if the version goes
  "started_by" uuid REFERENCES "members"("id") ON DELETE SET NULL,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_by" uuid REFERENCES "members"("id") ON DELETE SET NULL,
  "finished_at" timestamptz
);
CREATE UNIQUE INDEX "design_reviews_seq_uq" ON "design_reviews" ("robot_id", "seq");
CREATE UNIQUE INDEX "design_reviews_open_uq" ON "design_reviews" ("robot_id") WHERE "finished_at" IS NULL;
ALTER TABLE "design_reviews" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "review_comments" ADD COLUMN "design_review_id" uuid REFERENCES "design_reviews"("id") ON DELETE SET NULL;
ALTER TABLE "review_comments" ADD COLUMN "anchor" jsonb;
CREATE INDEX "review_comments_design_review_idx" ON "review_comments" ("design_review_id");
```

Not read through `cached()` (it's loaded with the comments, which aren't), so no `data_versions`
triggers. Drizzle: `designReviews` in `schema.ts`, `db:generate`, renamed to `0097_design_reviews`.
Server code: `src/lib/reviews/designReviews.ts` (start, finish, list, link / unlink, `openDrFor`),
server actions next to the CAD page's; `loadRobotReview` / `loadSystemReview` return the robot's DRs.

## MCP (`src/lib/mcp/toolsets/cadReview.ts`)

- `list_review_comments` (system and robot): each comment gains `design_review` (`{ id, name:
  "DR 3", version: "R7" }`) and `anchor` (`{ kind, part }`); new optional `design_review_id` filter.
- New read `list_design_reviews` (robot_id): each DR with its State text, systems, version, who
  started / finished it and when, open or not, and its comment counts by status.
- New writes (admin, previewed then confirmed like the others): `start_design_review` (robot_id,
  state, system_ids optional = whole robot), `finish_design_review` (robot_id).
- New write `set_comment_design_review` (comment_id, design_review_id or null): author or admin.
- `add_review_comment` links to the open DR by the same server rule. `tools.test.ts` count updated.

## Pieces, in order (each ships on its own)

1. **Panel and Add comment window** (no database): floating top-left Add comment window, bigger
   section headers and cleaner dividers, Esc no longer folds the column, taller header with the
   State filter, row hover highlight. Picks while writing still link a part (as today).
2. **Edge / face / point links and 3D bubbles**: migration 0097 (the whole of it; the DR table
   stays unused until piece 3), `anchor` saved from the Add comment window, `anchor.ts` re-finding
   with tests, the tag's close-up frame + select (no isolate), the ☐ checkbox, avatar bubbles and
   the comment-shaped popup, hover highlighting the anchored geometry. Test on `/dev/viewer`.
3. **Design Reviews**: Start / Finish DR (admins), the corner glow, auto-linking, the DR tag and its
   popup, ⋮ Add to / Remove from DR, the DR's ▾ filter with hover popups, the MCP tools.

Pieces 2 and 3 don't depend on each other's code beyond the migration, so 3 can go before 2 if
DRs are wanted sooner.

## Open questions for Harel

1. **Robot version at Start DR**: make a new `R<n>` each time (planned), or tag the DR with the
   newest existing robot version and only make one when there's none?
2. **A DR on some systems only**: comments written meanwhile on other systems stay out of it
   (planned), or does every comment written during an open DR join it?
3. **Hover**: "highlight it slightly" read as hovering a comment in the panel or its 3D bubble
   tints the row and lights up its edge / face in the 3D view. Right?
