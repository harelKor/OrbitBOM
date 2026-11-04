# Inventory upgrade — plan v0.2

Status: v0.2, 2026-10-22. Nothing built. Harel's answers (09:17) are folded in; see §9.

## 1. What's there today (and why it feels disconnected)

- **/inventory** is the FRCBOM copy: groups tree on the left, a toolbar of four admin dialogs
  (Groups, Part types, Conditions, Locations) plus Import and Add, then tall text cards
  (name, chips, spec line, vendor, "Used by N parts", − / +, To BOM / Edit / Delete).
- **Parts link to items** only through the part's Material menu (`parts.inventory_item_id`) or
  the item's To BOM button. Nothing suggests a link, so in practice few parts get linked.
- **Usage is computed on read** (`src/lib/inventory/usage.ts`): each robot is allocated on its
  own, and "Used" = the most any one robot needs (FRCBOM rule: "same units are available again
  to another robot").
- **COTS keeps its own stock**: `parts.stock_count` with red − / green + on the COTS card, and
  reaching the quantity sets the part to In Stock. This number never touches the inventory.
  So the team has **two stock counts that don't know about each other**: the shelf
  (`inventory_items.in_stock`) and each COTS part's count.
- The robot dashboard's "Inventory on this robot" panel lists linked items as in stock / needed.
- MCP: `search_inventory`, `adjust_stock`, `add_inventory_item`.
- No history of who changed stock, no photos shown (the `image_path` column exists), no reorder
  level, and the Order List can't see what's already on the shelf.

## 2. The idea in one paragraph

**One item = one thing on the shelf, and it is the only place stock lives.** Every COTS part in
a robot points at an item (suggested automatically, confirmed in one click). The COTS card's
− / + and the Order List's "In Stock" both move the *item's* stock. Released shows "need 8 ·
have 6 · order 2", so nobody buys what's already in the drawer. Every stock change is a line in a
small history log (who, why, which part/order), which also gives undo.

## 3. Structure (navigation)

```
Inventory                       ← sidebar item, collapsible list of categories with counts (like To Fab)
├─ /inventory                   ← home: search first, then category boxes, then "Short" and "Low" boxes
├─ /inventory/c/[category]      ← card grid of one category (Bearings, Gears / Pulleys, Motors…)
├─ /inventory/short             ← items active robots need more of than we own (→ send to Order List)
└─ /inventory/item/[id]         ← one item: photo, stock, specs, links, "Used in", history
Robot dashboard
└─ /robots/[id]/inventory       ← this robot's needs: covered / short, per system
```

- **Categories replace the groups tree.** They're a fixed list in `src/config/` (project rule),
  and I'd reuse the COTS filter boxes (`COTS_CATEGORIES`) plus a few inventory-only ones
  (Bearings, Shafts, Electrical). Plates and tubes are in (counted as whole sheets / bars);
  screws, nuts and other small fasteners are **not** tracked. Same boxes, same pictures, on both pages, so a
  student learns one vocabulary. A part's COTS category becomes its item's category by default.
- **Part types stay** (they're already config) and give each category its spec fields
  (Bearings → OD / ID / width; Gears → DP / teeth / bore).
- **Locations stay** as a short team-edited list (shelf / bin names), but move into the item form
  instead of a toolbar dialog. **Conditions stay** (Harel) and colour-mark the item cards.
- Edit mode hides add / import / delete as today; View mode keeps search and − / +.

## 4. Screens (Orbit look: #f2f2f2 page, white cards, #0000cc bars, Jost display headings)

### Inventory home
- Big search box on top: "Do we have 608 bearings?" Matches name, specs, vendor and part number;
  this is the main action on the shop floor (often from a phone).
- Category boxes like the COTS home: picture, `display` count of items, small red dot when
  anything inside is short.
- Two launch cards under them, the same size as To Fab / To Review on the robot dashboard:
  **Short for robots** (count) and **Low stock** (below its reorder level).

### Item card (4:3, same skeleton as the part / COTS cards)
- Top: thumbnail well. Team photo if uploaded, else the Onshape thumbnail of a linked part
  (free, already cached), else a category placeholder.
- Overlay top-left: category pill. Top-right: location pill (📍 Shelf B3).
- Footer row 1: name (truncate) + spec in mono (`22T · 1/2" hex`).
- Footer row 2: big mono stock number, `need 8` beside it, red − / green +. The card's edge is
  tinted like status tints: green covered, amber short, grey not used.
- Footer row 3: "Used in 3 parts" pill (opens the list) and the vendor link pill.

### Item page
- Left: photo, stock stepper with a reason picker (Received / Used / Broke / Counted), reorder
  level, location, vendor links + price ($ / ₪ like COTS).
- Right: **Used in** — every linked part grouped by robot › system, each a link to the part in
  its BOM, showing covered / short. **Possible matches** — unlinked COTS parts that look like
  this item, with Link buttons. **History** — the last stock moves.

### Robot inventory page (from a third launch card on the robot dashboard)
- Header numbers: `34 / 40 parts covered`, `6 short`.
- Table or cards per system: part, item, need, have. Shortages have one button:
  **Send shortages to Order List** (sets those COTS parts to In Order List with the missing qty).

### On the COTS card and part card
- A small **inventory pill** (`📦 6/8`): click opens a popover with the linked item, "change
  item", "unlink", and the stepper. Unlinked COTS parts show a dashed "Link inventory" pill with
  the best suggestion pre-filled.

### Released / Order List
- Each card shows `need · have · to order`. A part fully covered by the shelf shows "In
  inventory" and doesn't need ordering.
- Marking a line **In Stock** on the Order List adds the received quantity to the item (and
  creates + links the item if the part had none, so the inventory fills itself as orders arrive).

## 5. Data model changes

1. **`inventory_items`** gains: `category` (config id), `cots_links` jsonb + `unit_price` (same
   shapes as parts, replacing `vendor_url` / `vendor_name` / `price`), `reorder_at` int,
   `onshape_key` text (did:eid:partId of the library part, for auto-matching) and `aliases`
   text[] (other names students call it). `group_id` migrates to `category`.
2. **New `inventory_moves`**: `id, item_id, delta, reason (received | used | broke | counted |
   returned), part_id?, robot_id?, member_id?, ai_name?, batch_id?, created_at`. `in_stock`
   stays on the item as the running total, updated in the same transaction as the move.
3. **`parts.stock_count`**: for a part linked to an item it is no longer edited; coverage comes
   from the allocation. It stays for unlinked COTS parts, and the first receive links them.
4. **Allocation** (`usage.ts`) changes from "each robot alone" to "all active robots share the
   shelf" (Harel: one shared shelf). Need = sum over active robots; archived robots don't count.
   Still computed on read, never stored.
5. **Status**: no automatic change (Harel: not auto In Stock). When the shelf covers a COTS part,
   its card shows a small popup suggestion: "6 on the shelf · Take from inventory and mark In Stock?"
   One click accepts (writes a `used` move and sets In Stock); dismiss hides it. `computeStatus`
   is untouched.
6. The inventory groups table can be dropped. No need to keep the app's current
   inventory rows (the real data lives in FRCBOM and gets its own migration plan after the build).
   One migration.

## 6. Matching parts to items

Suggested in this order, highest confidence first:
1. Same Onshape library part (`did:eid:partId`), e.g. the same REV bearing inserted in ten
   places.
2. Same product link (any of the part's `cots_links` = any of the item's).
3. Same normalized name, or a name in the item's `aliases`.
4. Spec match inside a category (gear 22T 1/2" hex ↔ item with those spec values), as a
   "maybe".

Rules 1–3 can auto-link on Update BOM; rule 4 only suggests. Suggestions show on the item page,
the part's inventory pill, and as an MCP read.

## 7. AI / MCP tools (preview → confirm → undo, like the existing ones)

| Tool | What it does |
|---|---|
| `search_inventory` (upgrade) | Search by name, specs, category, location; returns have / need per item. |
| `inventory_to_link` + `link_inventory` | Unlinked COTS parts with candidate items; Claude picks matches and applies them in one batch. |
| `inventory_shortages` | Per robot: what's short and how many to order. Pairs with `set_cots_info` / a "send to Order List" write. |
| `add_inventory_items` (bulk) | Paste a spreadsheet, a vendor order email, or a photo of a shelf into your own Claude; it creates the items. Also the likely route for the FRCBOM migration. |
| `inventory_to_look_up` + `set_inventory_info` | Same as the COTS lookup: fill product links, prices, specs, category for items. |
| `adjust_stock` (upgrade) | Takes a reason; writes a move; undoable. "We used 4 bearings on the intake" → done. |

## 8. Features, in the order I'd build them

**Round 1 — connect it (the actual ask)**
1. One stock source: COTS − / + and Order List In Stock move the item's stock; moves log;
   the "take from inventory" popup on covered COTS cards.
2. Auto / suggested linking of COTS parts to items; inventory pill on COTS + part cards.
3. Released / Order List show need · have · to order.
4. Robot inventory page + dashboard launch card + "Send shortages to Order List".

**Round 2 — make it pleasant**
5. New home (search + category boxes), 4:3 item cards with photos / Onshape thumbnails, item page.
6. Categories from config replace the groups tree; conditions colour the cards.
7. MCP tools above.

**Later, only if wanted**
8. Reorder levels + Low stock box + restock lines on the Order List that aren't tied to a robot
   part (needs a small `order_lines` table).
9. QR labels per bin / item: print a sheet, scan with a phone to open the item and tap −.
10. Stocktake mode: walk a shelf, type counts, it writes "counted" moves.

## 9. Decisions (Harel, 2026-10-22)

1. **All robots share one shelf.** Need is summed over active robots.
2. **Everything mentioned goes in, including plates; not screws.** Fasteners stay out.
3. **Not auto In Stock.** A popup suggestion on the card instead (§5.5).
4. **Existing data is in FRCBOM.** Build everything first, then plan a migration route.
5. **PC first, then phone**, but phones get heavy use, so every screen must work at phone
   width (search, card − / +, the popup) even if the layout is tuned for desktop.

6. **Sheets in fractions** (09:26): plate stock is whole sheets plus 1/4, 1/3, 1/2, 2/3, 3/4
   pieces. Stored as a number snapped to twelfths, shown as `2 ¾`.
7. **Conditions stay**, and they mark the item cards (colour chip / edge).
8. **Part types are built into the app** (config, no user-made types), so each type gets its own
   tuned UI and the AI knows every type's fields and options when it fills specs.
9. **Go-ahead given for building** (09:26). Round 1 first, on branch `claude/project-thread-lgd1bu`,
   no PR until Harel asks.

## 10. Round 1 as built (2026-10-22, branch `claude/project-thread-lgd1bu`, PR #36)

- Migration `0018_inventory_stock`: `inventory_moves` (+ `stock_reason` enum), `in_stock` → double
  (sheets in twelfths), `inventory_items.onshape_key` + `aliases`.
- Shared shelf in `src/lib/inventory/usage.ts`; fill order In Stock → being ordered → rest.
- All stock writes go through `src/lib/inventory/moves.ts` (`moveStock`).
- COTS card: inventory pill (`src/components/cots/ShelfPill.tsx`), shelf − / +, "Mark In Stock?"
  prompt; Released/Order List table has a To order column.
- Ordered part → In Stock adds the shortfall (`src/lib/parts/apply.ts`).
- Update BOM auto-links new parts by Onshape key.
- `/robots/[id]/inventory` + dashboard Inventory card + Send shortages to Order List.
- MCP: `adjust_stock` (reason, undo), `search_inventory` (need/short/free).

## 11. Round 2 as built (2026-10-22, same branch / PR #36)

- Categories in `src/config/inventory.ts` replace the groups tree; `inventory_items.category`
  (migration 0019), guessed from part type or name while unset.
- `/inventory` home (search, category boxes, Short card), `/inventory/c/[category]`,
  `/inventory/short`, `/inventory/item/[id]`; sidebar lists categories.
- 4:3 item cards (`ItemCard.tsx`) with linked part's Onshape thumbnail; item page
  (`ItemPage.tsx`) with Used in, Possible matches, History.
- MCP: list_part_types, inventory_to_link, link_inventory, inventory_shortages,
  add_inventory_items, inventory_to_look_up, set_inventory_info.
- Not built: item photo upload, reorder levels / Low stock, QR labels, stocktake mode, FRCBOM
  migration.
