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

## Pages

- `/robots/<robot>/cad-review` (home card "CAD Review", left menu; follows the robot picked in the
  right panel): one 3D box per system with an assembly, its open / waiting counts on its name, and
  the whole robot in a wide box below. Boxes draw live only while near the screen (browsers allow a
  limited number of 3D views). A tap on a box (or on a part of the whole robot) opens the system.
- `/robots/<robot>/systems/<system>/cad-review`:
  - Left panel: + Add comment, Update system, the version tree (newest Onshape version big on
    top, older ones down a line; a version the BOM was updated to is marked, "BOM is on this" for
    the current one). Under each version: the comments added while it was the newest, and those
    ticked off at its commit or while it was the newest.
  - 3D view: tap a part → its name, size, Add comment, Hide, Only this. Tools: Fit, Iso / Front /
    Top / Side, Section (axis, position, flip), Measure (two points, ≈ mm). Colours: CAD, or the
    changes in the BOM's current version (shape / properties / added, removed listed).
  - Top right: Open comments (tick box, date, author, part chip; a tap shows the part), and for
    mentors "Waiting for you" (Approve, or Reject with why, which opens it again). Folded on phones.
- Update system's Commit window has an Open comments panel: the ones ticked there are done at the
  version committed.
- System page: a "CAD Review" chip with the counts. Home card badge: comments waiting on you
  (mentor: to approve; CAD Team member: open on their system).
- MCP: `list_review_comments`, `add_review_comment`, `tick_review_comments`.

## Who can do what (Harel, 2026-11-08)

- Anyone signed in comments (Build Team included); its author (or an admin) deletes an open one.
- The CAD Team and Edit mode tick comments off (and take a tick back), mentors too.
- Only mentors (`isMentor`, set by an admin on /members) approve or reject.

## Not in this plan

- Push notifications (the badge covers it for now).
- Older versions in 3D (each would mean exporting it: calls).
- Mates and motion, feature tree, sketches: Onshape.
