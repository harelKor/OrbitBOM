# Inventory round 4 — plan v0.1 (not built)

Written 2026-10-23 from Harel's task list (14:06) and the code on `main` after PR #37.
Branch when it's built: `claude/project-thread-lgd1bu`. Nothing in this file is built yet.

## 0. Already started, not pushed

Before this list came in, I'd started on Harel's 11:43 note ("you can't add anything"). None of it is pushed yet:
- **Adding in View mode.** The add box only adds in Edit mode (`AddBox.tsx` checks `useEditMode`).
  The fix is to let it add in both modes. Nothing has changed in that file yet.
- **Category picture.** The `image` column on `inventory_categories` (migration 0022) is written
  locally. There's no upload or display for it yet.

Both go in round A.

## 1. Item card

| Ask | What I'd do |
|---|---|
| Change the overall amount | Tap the stock number on the card (it reads "12 in stock") and it turns into a number box. Type the real count and press Enter. It saves as a "Counted" move of the difference, so the ledger stays right. The same box goes in the item window. |
| Remove the extra details ("15T · #35 · …") | Drop the spec line from the card. The specs stay in the item window and in search. |
| Bigger names | The name goes from 14 px to about 17 px semibold and can wrap to 2 lines instead of being cut off. |
| Tags lead to their page | **Category** tag → `/inventory/c/<category>`. **Location** tag → a new `/inventory/l/<location>` page, laid out like a category page (same filters, add box defaults to that location). **Condition** tag → the item list filtered to that condition. Right now the tags sit on top of the picture and can't be clicked. They'll become real links. |

## 2. Item window (replaces the jump to the item page)

- **Opens straight away.** Clicking anywhere on the card except the name, the tags and the −/+ buttons opens it at once. The list already has the item's data in the browser, so the window draws with no wait. Only the history and the "used by" list load after it opens.
- **Smaller and closable.** A window about 560 px wide, centred, with an X, Esc and a click outside to close. On a phone it's full width. The URL gets `?item=<id>`, so the back button closes it and a link to it can be shared. The full `/inventory/item/<id>` page stays for old links, but nothing in the site points to it any more.
- **Inside:**
  - photo (tap to replace or take one, see §6), name, tags;
  - the count box from §1 with −/+;
  - specs, price and links;
  - the parts that use it;
  - **Find BOM parts** (§4);
  - a pencil to edit, using the same form as adding;
  - history.
- **History shows count changes too.** Every move is already listed: received, used, broke, counted and returned. A typed count will show as "Set to 12 (was 9) · Harel · 2 min ago". Edits to the item itself (name, category, specs, location, links) aren't saved anywhere today. A small `inventory_item_history` table will hold them, so history is one timeline of both.

## 3. Inventory home

**Location search.**
- Typing a location name in the box ("drawer 3", "shelf B") filters to items there.
- A **📍 Location** chip row under the box filters with one tap.
- Each location's page is the new route from §1.

**Search bar rows.** Clicking anywhere on a product row picks it. If the row has several stores, it uses the cheapest one that has a price, else the first. The store buttons on the row still pick that exact store.

**Recent actions (collapsible, below the categories).** This works like the robot dashboard's Recent actions:
- One box for each page visit in which someone changed the inventory.
- Each box shows who did it, how long ago, and what changed (Stock, Added, Edited, Linked), with up to 6 item thumbnails.
- Clicking a box opens that item's window.
- X hides the box for you. Boxes drop off after 7 days.

This needs the visit id on `inventory_moves` and on the new item history. The robot dashboard groups `part_history` the same way. Whether the section is open or closed is remembered per browser.

**All items (collapsible).** Every item as cards, with the condition and location filters. Remembered open or closed the same way.

## 4. Auto-link, redone

**Why it doesn't work now.** It only links when the BOM part is the exact same Onshape library part as the item, or has the exact same product link. A new item has no Onshape part, and most BOM parts have no product link. So in practice nothing matches. Names were left out on purpose.

**When it runs.**
- When an item is created or edited: it searches the BOM for parts that belong to that item.
- From the **Find BOM parts** button in the item window, which runs the same search for that one item.
- On Onshape sync, for new parts (this already happens).

**How it matches.** It gives each part–item pair a score from whatever the part already has. The part doesn't need to be set up first.

| Signal | Weight |
|---|---|
| Same Onshape library part (`did:eid:partId`) | certain |
| Same product link | certain |
| Same thumbnail as a part already linked to the item (an image fingerprint, saved when the thumbnail is saved) | strong |
| Same Onshape library document and Part Studio, different part (e.g. another FRCDesignLib pulley size) | weak, needs the specs to agree |
| Name words: the item's name and aliases against the part's name and Onshape name, ignoring filler words | medium |
| Specs found in the part name agree ("36T", "1/2 hex", "HTD", "8mm") and none disagree | medium; one clear disagreement (24T against 36T) rules the pair out |
| The part's COTS category fits the item's category | small |

Each part gets at most one suggestion, the item with the best score. Ties are left out, and so is anything under the threshold. The reason is shown on the card, for example: "Name and 36T, 1/2 hex match · same thumbnail as Shooter > Pulley A".

**Approval.** Every link waits in **To Review** with an AUTO-LINK badge and the item's name and photo. Approve links it. Reject drops it and remembers the "no", so that pair isn't suggested again. See question 1 for whether a link is live before it's approved.

**AI can link too.**
- `inventory_to_link` gives your Claude the scored candidates and their reasons.
- `link_inventory` sends its links to To Review with the AI badge and the AI's name, like `set_up_parts`. Today it applies them directly.

## 5. Rest of the fast-add plan (§2, §5a, §7 of inventory-fast-add.md)

- **Add in View mode** (§0).
- **Enter saves.** When smart typing understood the whole line ("36t htd 1/2 hex pulley"), Enter saves the item right away. A green bar then offers Edit / Add another.
- **Recent picks first.** In chip rows and dropdowns, the values you used lately come first.
- **Category picture.** Upload one in the category settings. It shows on the home box and as the card's picture when an item has no photo.
- **Drag to reorder fields** in the category settings. The ↑↓ arrows stay for phones.

## 6. Camera and photos

- **Take or upload a photo.** One button in the add form and in the item window.
  - On a phone it opens the camera directly (a normal file input with `capture`). On a PC it's a file picker or drag and drop.
  - The browser shrinks the photo to about 1200 px JPEG and uploads it straight to R2 with a signed link, the same way drawings are uploaded.
  - It replaces the product photo as the thumbnail.
- **Barcode or SKU scan.** A scan button next to the search box opens the camera. Android Chrome reads the code itself; iPhone needs a small free library (zxing). The code then goes into the box and searches the shelf and the stores. Many vendor bags carry a SKU, which finds the product faster than a photo would.
- **Recognise an item from a photo.** This stays with your own Claude, which costs $0. On the site, that would need a paid vision AI on the server. Send the photo to your Claude with the OrbitMech connector and say "add this to inventory". It already has `add_inventory_items`. I'd add a one-line hint under the photo button saying so.

## 7. Order of work

| Round | What | Migration |
|---|---|---|
| A | View-mode adding, Enter saves, recent picks, card cleanup and bigger names, clickable tags, location page and location search, whole-row pick in search | 0022 category image |
| B | Item window (instant, small, `?item=`), count box, item history, edit from the window | 0023 item history, visit id on moves |
| C | Auto-link redone (scoring, thumbnail fingerprint, Find BOM parts button, To Review approval, AI linking through To Review) | 0024 thumbnail hash, rejected pairs (and pending links, if question 1 is yes) |
| D | Home sections: Recent actions and All items | none |
| E | Photos and camera, category picture upload, drag reorder, barcode scan | none |

Each round can be checked on the preview on its own. I'd build them in this order on the one branch and push after each round.

## 8. Questions for Harel

1. **Should a suggested link count before it's approved?**
   - *Recommended:* no. A suggested link waits in To Review and isn't live until Approve, so a wrong guess never changes "need" or "short".
   - The other way follows the AI-tools pattern: the link is live at once and Reject undoes it.

   Fuzzy name matching will guess wrong more often than the exact matches did, which is why I'd wait for Approve.
2. **"Overall amount"** I read as the in-stock count, typed in directly. If you meant something else, for example a total that includes what's on the robots, tell me.

## 9. Decided (Harel, 2026-10-23 14:19) — GO

- No adding in View mode (his mistake); the add box stays Edit-only.
- Category pictures: Harel sends them later; no upload UI for now.
- Suggested links wait in To Review and are NOT live until Approve.
- "Overall amount" = the in-stock count, typed directly.

## 10. Built (2026-10-23, branch `claude/project-thread-lgd1bu`)

All of rounds A–E. Migrations 0022_inventory_category_image, 0023_inventory_item_history,
0024_inventory_link_suggestions (part_reviews.pending, parts.thumb_hash, inventory_link_rejections).
Next new migration is 0025. Category picture upload not built (Harel sends pictures; boxes and cards
show `inventory_categories.image` when set). Barcode scan uses @zxing/browser, loaded on demand.
Thumbnail fingerprints: new thumbnails get one on fetch; older ones are filled 120 per auto-link run.
