# Design review (mentors review CAD in the app)

Status: phase 1 built (2026-11-08): migration 0074, `src/lib/reviews/rounds.ts`, `/reviews`, the
home card "CAD Review" (picture to come from Harel). Also in phase 1: systems can follow their CAD
document's Onshape versions (no Manufacture document), and 3D files are keyed by Part Studio
revision everywhere. The comments table comes with phase 2.

## Goal

Mentors review a student's design on their phone without opening Onshape: a 3D view of the exact
version the student sent, comments pinned to parts, and rounds (send → comments → fixes → send
again) until the mentor approves. Onshape stays where the design is made, with an "Open in Onshape at
this version" button for what a mesh can't show (feature tree, sketches, mates moving, exact
dimensions).

## The Onshape cost rule

A round is built **only when the student presses Send for review**, never on Onshape edits and
never when someone views it. Viewing reads R2 only (0 calls).

A round's build reuses the robot model pipeline (`src/lib/model/build.ts`):

| Step | Calls |
|---|---|
| Freeze: the assembly document's current microversion | 1 |
| Assembly definition at that microversion (every part and where it sits) | 1 |
| Tessellation of each Part Studio revision not already in R2 | 1 each, usually 0–3 |
| Appearances, only when some bodies came without a colour | 0–1 per studio |

So a typical round costs **3–6 calls**, and the first round of a new design about 2 + its Part Studio
count. 30 rounds a week ≈ 150 calls, inside the 500/day team limit and the 10,000/year allowance.
Meshes are shared with the robot model and the version previews by revision key, so a studio the
dashboard already exported costs nothing here. The build is member-asked work (not `background`),
run on the sender's Onshape account through `onshapeClient`, so it counts against the budget like
Update BOM. The mentor needs no Onshape account.

Freezing uses the document microversion (`d/<did>/m/<mv>/e/<eid>`, as `frozenStudio` does), not a
new Onshape version: no clutter in the students' Onshape version list, no extra call. Linked Part
Studios in other documents are already pinned to versions by Onshape, so the round is fully frozen.
The "Open in Onshape" button opens that microversion.

## Data (migration 0074, RLS on for each new table)

- `design_reviews`: one design under review. `id`, `robotId`, `systemId` (nullable: a design can be
  a system's assembly or any assembly link, e.g. a prototype not in the robot yet), `title`,
  `assemblyUrl`, `ownerId` (the student), `status` (`open` | `approved` | `closed`),
  `createdAt`, `approvedAt`, `approvedBy`.
- `review_rounds`: one Send for review. `id`, `reviewId`, `seq` (1, 2, 3…), `onshapeRef`
  (did / mv / eid), `model` (the built placements + studio keys, same shape as the robot model's
  `Built`), `state` (`building` | `ready` | `failed`), `note` (the student's "what changed"),
  `sentBy`, `sentAt`, `calls` (Onshape calls the build used, shown to admins).
- `review_comments`: `id`, `reviewId`, `roundId` (the round it was written on), `parentId` (replies),
  `authorId`, `body`, `partKey` (nullable; the part it's pinned to), `point` (x, y, z on that part
  in the model's frame), `camera` (position, target, hidden parts, section plane: opening the
  comment restores the view), `state` (`open` | `fixed` | `resolved` | `wontfix`), `fixedInRoundId`,
  `resolvedBy`, `createdAt`.
- Optional, later: a photo/sketch attachment on a comment (R2, like part files).

A review's status on cards comes from its rows, in one function like `computeStatus`: a new round
that no mentor has opened yet → "Waiting for mentor"; open comments on it → "Changes asked"
(waiting on the student); every comment marked Fixed and a new round sent → "Waiting for mentor"
again; approved → "Approved".

## Who can do what (decision for Harel)

Today `review` means To Review / Ready for QA (CAD and Edit). Proposed:

- **Mentor**: a new member flag `isMentor` (set on /members), not a new team, so a mentor can also
  be in CAD or Build. Mentors can comment, resolve, ask for changes and **approve**. A mentor with no
  team sees the app read-only except reviews.
- **Students (CAD / Edit)**: start a review, Send for review, reply, mark comments Fixed. They can't
  approve their own design.
- Everyone signed in can view reviews and comment (Build team members spot shop problems early).
- New capability `mentor` in `src/components/shell/mode.ts` (`can()` checks the flag), enforced in
  every server action with `requireCapability`.

## Pages

### `/reviews` (home tile "Design review")

Cards, newest activity first, filter by robot / system / status. A card: thumbnail (the round's
first render, saved from the browser like part thumbnails), title, system, round N, status chip,
open comment count, who it's waiting on, when. "Waiting on you" filter for mentors and owners.
"+ New review": pick a system (its assembly) or paste an assembly link, title, note → Send round 1.

### `/reviews/<id>`: the review screen

- Phone: the 3D view full screen; comments in a bottom sheet (peek shows the count and the newest,
  drag up for the list). Tablet / PC: comments in a column on the right, like the system page's
  Recent actions.
- Round picker at the top: R1 … Rn. Viewing an older round shows its comments as they were.
- **Compare** with the previous round: parts that changed (new Part Studio revision or moved) are
  highlighted, removed ones shown as ghosts, unchanged ones dimmed. Comparing placements and studio
  revision keys is free (both rounds' `model` rows), no Onshape calls.
- Student side: "Send for review" (round N+1, with a "what changed" note), progress while it builds
  (the browser calls the build route again until done, like the robot model), and on each comment
  "Fixed in this round".

### Viewer tools (on top of `ModelCanvas`, made into a shared viewer)

- Tap a part: name (from the BOM when the part is on it), select it, "Comment here".
- Pin a comment: tap → point on the mesh (raycast) → write. Pins show as numbered dots that stay on
  the part when the view turns; tapping a pin restores the comment's camera.
- Hide / isolate a part or a subsystem (groups exist already), show all.
- Section plane: one plane, drag to move, three axis buttons, flip.
- Measure: point to point and a part's bounding box, from the mesh (chordTolerance 0.5 mm: good for
  clearances, not tolerances; the label says "≈"). Exact checks go through "Open in Onshape".
- Standard views (front, top, side, iso) and "fit".
- Touch: one finger rotates, two fingers pan and pinch zoom. Buttons ≥ 36px.

### Elsewhere

- System page: a "Reviews" chip with the open review's status.
- Home: badge on the tile with the count waiting on you.
- MCP: `list_reviews`, `get_review` (comments as text), `add_review_comment`,
  `mark_comment_fixed` (write: preview → confirm), so a member's Claude can read and answer them.

## Phases

1. **Rounds and viewing**: tables, migration, `buildReviewRound` (the robot model build, generalised
   to one assembly at a frozen ref; shares studio meshes by revision key), `/reviews` list, review
   screen with the viewer, round picker, Open in Onshape. Tests: build call count against a mocked
   client (a second round with one changed studio = 3 calls), freeze key.
2. **Comments**: pinned comments with camera restore, replies, Fixed / Resolve / Approve, the mentor
   flag and capability, statuses, "waiting on you".
3. **Tools**: compare rounds, section plane, measure, standard views.
4. **Around it**: system page chip, home badge, MCP tools, cleanup of old rounds (below).

Each phase ships on its own and is usable: after phase 1 mentors can already look at a frozen
design on a phone and talk in the existing chat.

## Storage

R2 grows only by the Part Studio revisions a round adds (shared with the robot model). Approved or
closed reviews keep their last round; meshes of older rounds that nothing else uses are deleted
after 60 days, through the storage usage accounting in `src/lib/storage/usage.ts`. Stays inside R2's
free 10 GB. No new cloud resources.

## Not in this plan

- Push notifications (there's no web push in the app yet; the badge covers it for now).
- Drawing markup / 2D drawings review.
- Mates and motion, feature tree, sketches: Onshape.
- Mentor accounts outside Google sign-in.

## Risks to check in phase 1

- Big assemblies on a mid-range shop phone: test a full robot round on one before phase 2.
- An assembly that links a workspace (not a version) of another document: that studio isn't frozen
  by the assembly's microversion; read that document's microversion too (1 extra call, as the robot
  model does) and say so in the round's details.
- A send while the team's daily Onshape budget is used up: the round fails with the budget message
  and the student can send again tomorrow; nothing half-built is shown.

## Decisions (Harel, 2026-11-08)

1. Mentor = an `isMentor` flag on members, not a fourth team.
2. Only mentors approve; students can't approve their own design.
3. Build team members can comment.
4. Phase order as above: comments before section and measure.
