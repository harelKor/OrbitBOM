# Inventory: Needed for Season, Short toggles, category groups (plan v0.2)

Thread "Plan season needs in Inventory", 2026-10-27. Plan only; build after Harel approves.
v0.2 (Harel 08:36): no Pneumatics or Safety & Pit; groups and new categories also on the COTS
filters with a breadcrumb; the cart turns orange with the card and then opens the part on COTS.
Push straight to main. One migration: `0032_inventory_season`.

## What exists today (checked in the code)

- `inventory_items.in_stock` is the shelf count; sheet items (plates) count in twelfths.
- `computeUsage` (src/lib/inventory/usage.ts) gives each item its robots' `need` / `short`, summed
  over every active robot's linked parts. Sheet items never have a robot need.
- The home page has a "Short for robots" card that links to `/inventory/short`, then one box per
  category (count + an amber "N short" pill).
- `addCotsFromItem(itemId, robotId | null)` in cots/actions.ts already makes a COTS card from an
  item in Released (General when robot is null). This is what the new card icon will reuse.
- When a linked COTS card goes from the Order List to In Stock, `applyEachPartChanges` adds the
  missing units to the item's stock. So an order sent from Inventory fills the shelf by itself.
- Categories live in `inventory_categories` with the settings panel. There is no grouping above them.

## 1. Needed for Season

**Database (0032)**
- `inventory_items.season_need double precision null`. Null (or 0) = no season need, so the item is
  not in the Season view. Sheet items take pieces like stock does ("2 ½").
- `parts.restock boolean not null default false`. Marks a COTS card sent from Inventory to refill
  the shelf. These cards are left out of the robots' need, so an order doesn't make the item look
  short for robots. They still count as "on order" for the orange colour, and when they reach In
  Stock the existing receive logic adds their whole quantity to the item.

**Item window**
- A "Needed for Season" number box in the free space on the right of the window header, under the
  count stepper. It saves on blur or Enter, records an item history row
  ("Needed for season 4 (was 2)") and syncs nothing else. Read-only in View mode, editable in Edit
  mode, like the other item fields.
- The line under the stepper becomes e.g. "Season needs 6 · Robots need 4 · 2 short".
- MCP `set_inventory_info` gets `season_need`, so the AI can fill it too.

**Card count `X / Y`**
- The pill between − and + shows `3 / 6` (tabular-nums, font-mono). "in stock", "sheets" and
  "/ need" are dropped; sheets keep their "pieces ▾" button.
- Y depends on the view: Season view = season need; Robots view = robots' need; everywhere else =
  the bigger of the two. When nothing is needed the pill shows just X.
- X turns red when it is under Y.

**Cart icon (thumbnail top-right)**
- A small frosted cart button, `active:scale-[0.98]`. The Ordering / location tags move down one
  row under it.
- **Short, nothing on order:** the cart is plain (white on frosted glass), title "Send 3 to
  Released". Click: `sendItemToReleased(itemId)` makes one General COTS card (robot null,
  `restock = true`, quantity = how many are missing, rounded up for sheets), in Released, linked to
  the item. Same code path as `addCotsFromItem`, with the quantity and flag added.
- **On order:** the cart turns orange (#f59e0b) and so does the whole card (the BOM `statusTint`
  for the orange COTS status), on every Inventory page, not only in the Short views. The old
  "Ordering" tag goes, since the cart says it now. Title "In Released: open it" (or "In Order
  List", "Seen", "In Route").
  Clicking it opens that card on the COTS page: `/cots/released?part=<id>` (or `/cots/order-list`
  when it moved on). The page scrolls to the card (`part-<id>` already exists on CotsCard) and gives
  it the sky glow for a few seconds, clearing any filter that would hide it. With several open
  cards it opens the newest.
- **Not short, nothing on order:** no cart.
- Shown in View mode too: sending to Released is a normal shop action, not an edit of the system.
  Say if you want it Edit-only.

"Open order" = any linked COTS card in Released, In Order List, Seen or In Route.

## 2. Short for Season / Short for Robots toggles

- The big "Short for robots" card is split into two equal boxes side by side, each with its count:
  **Short for Season** (items under their season need) and **Short for Robots** (items short for
  the active robots). On a phone they sit side by side at half width.
- Clicking one switches the home page in place to a filtered grid (no page load). Clicking it again,
  or the other one, switches off / over. The choice is kept in the URL (`?view=season` /
  `?view=robots`, set with pushState so it's instant and survives refresh). `/inventory/short`
  redirects to `/inventory?view=robots` so old links work.
- The active box gets the sky-400 border and a filled background.
- **Season view** shows every item with a season need, met or not. **Robots view** shows every item
  linked to a part on an active robot (in stock or not). Search, condition and location filters
  still apply, and so does a selected category group (section 3).
- Sort: red first, then orange, then green, then by name.
- **Card colour**, using the same `statusTint` as BOM cards:
  - Red (Reproduction #ff0000): X < Y and no open order.
  - Orange (In Order List #f59e0b): an open order exists (sent to Released or further).
  - Green (In Stock #04ff00): X ≥ Y.
  Red and green apply only in these two views. Orange shows on every Inventory page (see the cart);
  elsewhere cards keep today's condition edge.

## 3. Category groups (Inventory and COTS)

- New fixed list in `src/config/inventory.ts` (`CATEGORY_GROUPS`), each with id, label and icon:

| Group | Categories |
|---|---|
| Consumables | Shafts, Round tubes, Square tubes, Aluminum plates, Polycarbonate, Filament, + new **Shop supplies** (zip ties, tape, Loctite, grease, rivets) |
| Electrical | Motors, Electrical, + new **Controllers & sensors**, **Wiring & connectors**, **Batteries** |
| COTS | Gears, Pulleys, Sprockets, Belts, Bearings, Wheels, + new **Chain**, **Hubs & spacers** |
| Tools | new **Fasteners**, **Hand tools**, **Power tools & bits** |
| Bumpers & Field (FRC extra) | new **Bumper materials** (fabric, pool noodles, plywood), **Field elements** |
| General | Other, and any category without a group |

- DB (0032): `inventory_categories.group text not null default 'general'`; the migration sets the
  group of the existing categories and inserts the new ones (skipped if an id already exists).
  The settings panel gets a "Group" dropdown per category, so the team can move them.
- Note: screws were left out of the inventory on 2026-10-22. Your Tools group lists fasteners, so I
  add a Fasteners category; say if screws should stay out.

**How the boxes work (same on both pages)**
- The top level shows one box per group (count, picture or icon).
- Clicking a group box replaces the row with that group's category boxes, in place. Above them a
  small route line: `All categories / Electrical`. Clicking "All categories" goes back to the
  group boxes. Clicking a category box drills one level more on COTS
  (`All categories / Electrical / Motors`, filters the cards); on Inventory it opens the category
  page as today, and that page shows the same route line (`Inventory / Electrical / Motors`).
- The selected group and category are kept in the URL (`?group=electrical&cat=motors`, pushState,
  no reload), so Back works and a refresh keeps the place.
- **Shortfall highlight**: the count number turns red when any item in the box is short (season or
  robots), with a small "N short" pill beside it; otherwise it shows in the accent colour. In a
  Short view the boxes count only that view's items, so the numbers match the grid. On COTS the
  boxes count cards as today (no short highlight there).
- **Inventory home layout**: search box → the two Short toggles → group boxes (or a group's
  category boxes) → Recent actions / All items. In a Short view, a selected group or category
  narrows the grid.

**COTS page changes**
- The fixed `COTS_CATEGORIES` list goes; the COTS filters use the inventory categories and groups
  (one category list for the whole app).
- A COTS card's category: its linked item's category; else its own `parts.cots_category` (now an
  inventory category id); else guessed from its name with the inventory guesser; else Other.
- 0032 maps old values: motion → gears / pulleys / sprockets by name (else gears); belts, motors,
  wheels, round-tubes, square-tubes, polycarbonate, aluminum-plates, other keep their ids.
- The card's category picker, To Review, and the MCP COTS tools take inventory category ids.

## Files touched

- `src/db/schema.ts`, `drizzle/0032_inventory_season.sql` (via `npm run db:generate`, plus the
  data inserts).
- `src/config/inventory.ts` (groups, new seed categories), `src/lib/inventory/usage.ts` (open order
  flag, skip restock cards), `src/lib/data/inventory.ts` (season need, open orders),
  new `src/lib/inventory/season.ts` (short / colour rules, unit tested).
- `src/app/(app)/inventory/actions.ts` (`setSeasonNeed`, `sendItemToReleased`),
  `inventory/short/page.tsx` (redirect), `page.tsx` (read `view`).
- `src/components/inventory/InventoryView.tsx` (toggles, groups, sort), `ItemCard.tsx` (X / Y, cart,
  tint), `InventoryPopup.tsx` (season box), `CategorySettings.tsx` (group dropdown),
  `inventory/c/[category]/page.tsx` (route line).
- New shared `src/components/ui/CategoryBoxes.tsx` (group → category drill-down with the route
  line), used by Inventory and COTS.
- COTS: `src/config/cots.ts` (drop COTS_CATEGORIES), `src/lib/cots.ts` (category from item /
  inventory categories), `CotsView.tsx` (boxes, `?part=` scroll and glow), `lib/parts/changes.ts`,
  To Review labels, MCP COTS tools.
- MCP `set_inventory_info` / inventory read tools: `season_need`.
- Tests: season/colour rules, restock cards out of robot need, receive adds the full quantity.

## Choices I made (say if any is wrong)

1. Season need and robots' need stay separate numbers; the card and icon use the bigger one, they
   are never added together.
2. Sending orders the shortfall as one General card; the robot-specific Order List flow from each
   robot's Inventory page stays as is.
3. The cart works in View mode.
4. One extra FRC group: Bumpers & Field.
5. The orange card shows on every Inventory page, red/green only in the Short views.
