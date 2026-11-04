# To Fab and Fab batches, round 5: plan

Everything below is on the To Fab page (`src/components/fab/FabView.tsx`) unless it says otherwise.
No new database tables: G-code uses the batch file slot that already exists (`group_files`, type "gcode").
One small migration only moves existing parts off the two removed statuses (see 9).

## Page layout, top to bottom
1. **To Post Process** (only when something is there). Every batch with parts in Post Processing, on
   All machines and on that batch's own machine. Each batch shows its Post Processing parts as cards
   with the same big check mark as Ready for QA. A check moves the part to Ready for QA; it stays in
   the batch dimmed and struck through until you leave or refresh, so a second click undoes it.
2. **Released**: loose parts only, with no status colour on this page (cards stay plain white).
3. **Ready to Fab** (new): batches only. A new batch lands here. Light blue (the colour Released had).
4. **In process**, **Finished**: as today.

## Batches
5. **Ready to Fab is a To Fab section only** (Harel, 2026-10-24): batches whose parts are still Released sit there, light blue, with their status pill reading "Ready to Fab".
6. **Auto-batching**: dragging a loose Released part (or several) to Ready to Fab or In process makes a
   new batch for it (named "Laser 24/10" like the Fab button, on the part's current machine) and sets the status.
7. **Drag into a batch**: drop a card on an existing batch to add it; the part takes the batch's status.
   Dropping a part from another batch moves it out of that one.
8. **Machine statuses**: the batch status menu uses the machine's names ("Printing", "Cutting", "Sliced"),
   same as part cards.
9. **Shop statuses cleanup**: "Ordered" and "In Queue" (Build In Queue) leave the in-house status menus
   everywhere. Existing parts move: Ordered → Released, Build In Queue → Released (read that way, no data change). A pre-process
   counter that moved now shows In Process 1 instead of Build In Queue.
10. **G-code**: open batch shows "Upload G-code"; once uploaded it shows the file name with Replace
    and Remove. Closed batch shows a small G-code icon next to the download icon (click downloads it).
    Uploading moves parts below Gcoded up to Gcoded (Sliced on printers); parts further along keep their status.
11. **Thumbnail**: the "made by" picker moves onto the top of the collage. The collage sizes to the part
    count: 1 part fills it, 2 side by side, 3-4 in a 2×2, 5+ in a 3×3 (first 9).
12. **Priority colour** goes back to normal text once the batch is in Finished.

## Part cards on To Fab
13. "Open drawing" becomes a small drawing icon button (same place, tooltip "Open drawing").

## Questions (I'll go with the default if you just say "approved")
- A. Ready to Fab as a real status (default) vs. only a section name on To Fab with Released underneath.
- B. Where existing Ordered / Build In Queue parts go (defaults in 9).
