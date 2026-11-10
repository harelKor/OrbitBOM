# CAD Review (mentors review CAD in the app)

Status: redesigned and built (2026-11-08). Migration 0075 dropped phase 1's rounds
(`design_reviews`, `review_rounds`) and added `review_comments` and `members.is_mentor`. Kept from
phase 1: systems can follow their CAD document's Onshape versions (no Manufacture document), and 3D
files are keyed by Part Studio revision everywhere.

## Goal

Mentors review a system's design on their phone without opening Onshape, and the students see
what's asked of them and tick it off as they fix it.

## The Onshape cost rule

Viewing, commenting, ticking, approving and rejecting never call Onshape. The 3D views are the
robot's built model (Update 3D model, as before). The version tree reads a kept list of the design
document's Onshape versions: a system that follows versions refreshes it inside the 1 call its
check makes anyway; otherwise the tree's "Refresh from Onshape" reads it (1 call, CAD Team).

## Pages (named "CAD" in the app since 2026-11-09)

- `/robots/<robot>/cad-review` (home card and left menu "CAD"; follows the robot picked in the
  right panel): the whole robot in a wide 3D box on top, which opens the robot's CAD page; below
  it a box per linked system with its open / waiting counts: its 3D view on wide screens (drawn
  while near the screen), its picture on phones, two per row.
- `/robots/<robot>/systems/<system>/cad-review` and `/robots/<robot>/cad-review/robot` share one
  screen (`src/components/review/ReviewScreen.tsx`):
  - Wide screens: panel on the left (back link, name, + Add comment, then the page's own part),
    3D view beside it. Phones: the 3D view fills the screen under the top bar; "Versions" (top
    left) slides the panel in, "Tools" folds under it, + Add comment sits at the bottom; no name.
  - System panel: Update system and the version tree (newest version big on top, BOM updates
    marked, a tap folds a version). Robot panel: "Robot comments" and one folding button per
    system with its tree.
  - 3D: tap a part → name, size, Add comment, Open system (robot page), Open part, Hide, Only
    this; a second tap opens its BOM window. Tools: Fit, Iso / Front / Top / Side, Section,
    Measure, and on a system the colours of its current BOM version's changes.
  - Top right: Open comments and "Waiting for you / approval" (mentors and Edit mode). The robot
    page lists all of the robot's comments, each marked with its system or "Robot".
  - Add comment on the robot page: System (the picked part's system, else picked from a list) or
    Robot (`review_comments.system_id` null; every comment has its `robot_id`).
- Right panel system tiles: on a CAD page they open the system's CAD page, on a BOM page its BOM
  page, anywhere else they ask BOM or CAD.
- Update system's Commit window has an Open comments panel: the ones ticked there are done at the
  version committed.
- System page: a "CAD" chip with the counts. Home card badge: comments waiting on you.
- MCP: `list_review_comments`, `add_review_comment`, `tick_review_comments`.
- Snip (2026-11-10): 📷 Snip in the Add comment window cuts a rectangle out of the 3D view (a
  flash), then a drawing window (pen size, 8 colours, eraser, undo, Confirm). The picture is in
  R2 (`review-snips/`), the lines in `review_comments.snip` (migration 0078) so they stay
  erasable: anyone adds lines, the author erases any, others their own and show as "X changed".

## Who can do what (Harel, 2026-11-08)

- Anyone signed in comments (Build Team included); its author (or an admin) deletes an open one.
- The CAD Team and Edit mode tick comments off (and take a tick back), mentors too.
- Mentors (`isMentor`, set by an admin on /members) and admins in Edit mode approve or reject.

## Not in this plan

- Push notifications (the badge covers it for now).
- Older versions in 3D (each would mean exporting it: calls).
- Mates and motion, feature tree, sketches: Onshape.
