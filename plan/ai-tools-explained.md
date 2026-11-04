# How the AI part tools work, and how they could learn

Written 2026-10-21 from the code merged in PR #19. Nothing new was built for this note.

## 1. The two paths

Both paths end in the same place: the part's material, processes or type change right away, and the part is listed in **To Review** with its old values saved. Approve keeps the change. Reject puts the old values back (a field someone edited after the suggestion is left as edited).

| | Suggest setup button | Your own Claude (MCP) |
|---|---|---|
| Who thinks | Fixed rules in `src/lib/review/rules.ts` | Claude, in your own claude.ai account |
| Cost | $0 (runs on Vercel, no AI) | $0 to the site (uses your Claude plan) |
| Where | To Review page, Edit mode | Any chat with the OrbitMech connector |
| Badge on the card | RULE | AI |

There is no AI on the server. That is what keeps hosting free.

## 2. How the rules recognise a part (Suggest setup)

It only looks at CAD parts that have no material, or no process in any slot, and that aren't already waiting in To Review. It skips External parts.

1. **Size.** The robot's built 3D model is stored as mesh files in R2. The site reads the part's mesh from there and measures its bounding box (three sides in mm, smallest first). It saves this in the part's `geometry`. A part is measured again only when its Part Studio file changes. No Onshape call is made.
2. **Material.**
   - If Onshape's own material says aluminum, the part is flat (smallest side is at most a quarter of the middle side) and the smallest side is within 0.15 mm of a plate in `materials.ts`, it gets that plate, for example `3mm 6061-T6`. Polycarbonate works the same way with the Poly plates.
   - If Onshape's material is PLA, Onyx or PA612, it gets that 3D Printed material.
   - Anything else (thick blocks, tubes, shafts, unknown material) is left alone.
3. **Processes.** For the material it chose (or the one already on the part), it looks at what the team did before. If at least 2 parts with that material have a process set by a person, the most common process set wins. Otherwise it uses the defaults in `src/config/autoSetup.ts` (aluminum plates to CNC, polycarbonate to Laser, PLA/PA612 to Bambu, Onyx to Markforged, SLS to PCBway). Parts still waiting in To Review do not count as team examples.
4. A part that was marked COTS only because it had no processes becomes In-house when processes are set.

Each suggestion carries a one-line reason ("Onshape material Aluminum - 6061, flat and 3 mm thick: 3mm 6061-T6. CNC, the team default.") shown on the card.

**Known limits.** The size is an axis-aligned box of the part as modelled in its Part Studio, so a part modelled tilted can look thicker than it is. The mesh units (metres) and the sizes have been tested with synthetic data only, not yet against your real Onshape robot. Check a few suggestions before approving all.

## 3. How Claude recognises a part (MCP)

1. `list_materials`, `list_machines` and `list_statuses` give Claude the exact names to use.
2. `parts_to_set_up(robot_id)` returns every part that needs setup with: name, part number, system, quantity, Onshape material, body type, `size_mm`, and the site's own guess (`site_guess`) where the rules had one.
3. Claude decides using everything it can see, which is more than the rules use: the part name ("Side plate", "Spacer"), the system it belongs to, quantity, and the numbers. It can also ask you a question when unsure ("these 12 parts are 3 mm aluminum, CNC or HadasaS?").
4. `set_up_parts` takes one entry per part (material, processes, type, and a one-sentence reason). It first shows a preview and applies only after you agree (confirm token, and a second confirmation above 50 parts). Applied parts go to To Review with the AI badge, and `undo_batch` still reverts the whole batch.

Claude is better than the rules at odd parts, the rules are better at doing 200 identical plates quickly and consistently.

## 4. Self-learning from past configurations

**What learns today.** Only the process choice, and only in a simple way: it counts what people set for each material. The material choice does not learn, and Approve/Reject is not remembered. When a review is approved or rejected the row is deleted, so the decision is lost.

**The idea.** Treat every part a person has set up as an example, and every Approve or Reject as a vote. Everything is counting in the database, so it stays free. No model training and no AI service.

Proposed steps, in the order I would build them:

1. **Remember decisions.** Keep a small log table: part, what was suggested, by rule or AI, approved or rejected, plus the part's features at that time (Onshape material, thickness, name words, system). This is the base for everything else.
2. **Give Claude the team's precedent.** Add to `parts_to_set_up` a "similar parts" summary for each part, e.g. "14 other parts with Aluminum 6061 and thickness 3 mm: 12 are 3mm 6061-T6 + CNC, 2 are + HadasaS". Claude then follows team habits instead of guessing. This is the biggest gain for the least work.
3. **Learn the material too.** Count past parts by features (normalised Onshape material, thickness bucket, aspect, name words like "gusset" or "spacer") and the material and processes people ended up with. A suggestion is made only when there are at least N examples and a clear majority (for example 5 examples and 80% agreement). Anything less certain is left for Claude or a person.
4. **Use the votes.** A rule whose suggestions keep being rejected stops suggesting (or needs more agreement), and one that is mostly approved is trusted for bulk "Approve all". The card can show "12 of 13 similar parts were approved".
5. **Weigh recent work more.** Count this season's robot more than older ones, so a changed habit wins.

**Risks to be aware of.**
- *Cold start.* Past robot data was not imported, so it starts empty this season. The defaults in `autoSetup.ts` cover that, and it gets better as the team sets up parts.
- *Learning mistakes.* If wrong setups are approved without looking, the system repeats them. That is why only decisions by a person on a part count, and why Approve all should be used on groups you actually checked.
- *Name words are noisy.* They help (a "spacer" is usually lathe), but need a minimum number of examples.

**Cost.** Steps 1 and 2 are roughly one small PR (a table, one query, a few lines in the MCP tool). Steps 3 to 5 are another. I have not built any of it. Tell me when you want it.
