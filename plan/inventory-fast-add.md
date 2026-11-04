# Inventory: fast add and product linking — plan v0.2

Harel, 2026-10-23. Plan only, nothing built; waiting for "go". v0.2 takes in Harel's answers (settings
screen, dropdowns for long lists, category locations, BOM materials, auto-link through To Review). Goal: adding an item takes seconds. A bought product
comes from a web search in one pick. A custom item takes a few taps on its category's chips.

## 1. What's there today

- An item has a **category** (`src/config/inventory.ts`), an optional **part type** with detail
  fields (`src/config/partTypes.ts`, copied from FRCBOM), a **material**, one `vendor_url`,
  `vendor_name`, `price`, and an `image_path`. The add dialog asks for category, then part type,
  then fields, then material: many dropdowns.
- The card shows the vendor as a small pill; the name opens the item page.
- Linking BOM parts already works by Onshape library part, product link or name
  (`src/lib/inventory/match.ts`), on Update BOM and through Claude (`link_inventory`).

## 2. One add box (the core of the plan)

At the top of Inventory, one big field: **"Add an item: type a name or paste a link"**.

As you type, one dropdown shows three kinds of rows:

1. **Already on the shelf.** Existing items that match. This stops duplicates, and tapping one
   opens it with the stock stepper ready.
2. **Products.** Live results from the team's vendors, each with a thumbnail, name, vendor and
   price.
3. **Make it custom.** One chip per category ("Gear", "Pulley", "Bearing", …), with the typed text
   kept as a starting name.

**Bought product, 2 taps:** pick a product, set the quantity (stepper, defaults to 1), Enter.
The item gets its name, link, price, category and photo from the product.

**Pasted link, 1 tap:** paste a product URL and the site reads the page. Confirm the quantity.

**Custom item, about 4 taps:** pick the category chip. Its fields appear in one row:
- A field with **few options (up to 6)** shows them as chips (Flanged: yes / no).
- A field with **many options** is a dropdown you can type into: it filters as you type, arrow
  keys and Enter pick, recent picks sit on top (bore: ½" hex, ⅜" hex, 8 mm, …).
- A free field (teeth, length) is a small number box that takes focus next.
The name builds itself ("36T HTD 5mm ½" Hex Pulley"). The **location fills itself** from the
category (§5). Set the quantity and you're done.

**Smart typing (improvement):** typing "36t htd 1/2 hex pulley" already fills category Pulley,
teeth 36, pitch HTD 5 mm, bore ½" hex. Pressing Enter saves it. This is simple pattern matching
in code, so it costs nothing to run.

**Also:** "Add another like this" on the saved toast keeps every field, so a set of pulleys that
differ only in teeth takes one tap each. Recently used values sit first in every chip row.

## 3. The product search: how it works for $0

No paid search engine and no AI on the server. Three free sources, in this order:

1. **Vendor store search.** Most FRC vendors run standard store platforms with a public search or
   suggest endpoint that returns title, link, image and price as JSON (for example Shopify's
   `/search/suggest.json`). The server asks the team's vendor list in parallel (WCP, REV,
   AndyMark, ThriftyBot, SDS, CTRE, VEX, goBILDA, …) and merges the results. **To check per
   vendor before building:** which ones expose such an endpoint and allow it. A vendor that
   doesn't is left to the paste-a-link path.
2. **Paste a link.** The server fetches that one page and reads the standard product tags most
   stores publish for Google (`og:title`, `og:image`, schema.org `Product` price). This works on
   almost any store.
3. **Part number search.** COTS parts from FRCDesignLib usually carry the vendor's part number
   (e.g. `WCP-0123`). Searching by it finds the exact product.

A general web search API (Brave, Google) would cover every store but has small free quotas, needs
a card on file, and may change terms. I'd skip it unless the vendor list falls short.

Searches run only when someone types (debounced), never while a page renders. Results are cached
for a day so repeated searches don't hit the vendors.

## 4. Linked items behave like COTS parts

- **Name is the link.** Clicking the name opens the product site, light blue with an underline on
  hover. Several links (`cots_links`, like parts) get a small ▾ to pick one. A pencil edits them.
  The item page stays one tap away (thumbnail or a small open button).
- **Photo is taken automatically.** On link, the product image is downloaded once and stored in
  R2 as the item's thumbnail, so it never breaks when the vendor changes their site. Replace it
  any time with an upload or the camera (§6).
- **BOM parts link themselves, always on.** When an item gets a product link, every BOM part
  with the same link or the same Onshape library part is linked to it. The same happens in
  reverse: when Update BOM brings a part, or the AI looks up a COTS part and finds a link an item
  already has. Every auto-link lands in **To Review** like an AI change (badge "AUTO-LINK", reason
  "same product link" / "same Onshape part"). Approve keeps it; Reject unlinks. Name matches stay
  suggestions only, because names are noisy.

## 5. Categories replace part types and material

- **Part types and the free material field go away.** Each category has its own fields. The
  defaults below are seeded once; after that they live in the database and are edited on a
  settings screen (§5a). A starting proposal:

| Category | Fields (chips where there are common values) |
|---|---|
| Gears | Teeth, Bore, DP |
| Pulleys | Teeth, Pitch (GT2 3mm, HTD 5mm), Bore, Width |
| Sprockets | Teeth, Chain (#25, #35), Bore |
| Belts | Teeth, Pitch, Width |
| Bearings | ID / Bore, OD, Flanged (yes/no) |
| Shafts | Profile (½" hex, ⅜" hex, round), Length |
| Round / square tubes | Material (from the BOM list), Length |
| Aluminum / polycarbonate plates | Material (from the BOM list), Size (sheets keep the ¼ ½ ¾ pieces) |
| Motors | Model (Kraken X60, NEO, NEO 550, Falcon …) |
| Wheels | Diameter, Type (traction, omni, mecanum, compliant), Bore |
| Electrical | Kind (wire, connector, controller, sensor), Gauge / size |
| Filament | Material (from the BOM list), Color |
| Other | none, name only |

- Existing values move over in the migration: teeth, bore and pitch keep their meaning, and plate,
  tube and filament material becomes that category's Material field.

### 5a. Category settings screen

- Opened from a gear on the Inventory page, it slides in as a panel inside Inventory, not a new
  page. It uses the same cards and spacing, and saves each change in place with no Save button and
  no jumping layout.
- Per category: name, picture, default location, and its fields. Each field has a label, a kind
  (number, text, options, BOM material) and its option list. Drag to reorder; add or remove
  options inline. A field in use can be hidden but not deleted, so old values aren't lost.
- Data: a new `inventory_categories` table (id, label, image, default_location_id, fields jsonb)
  seeded from today's config. The COTS filter boxes keep using the config list, so COTS pages
  don't change.
- The repo rule "fixed lists live in `src/config/`, no settings UI" gets one exception written
  into CLAUDE.md: inventory categories.

### 5b. Category points to a location

- Choosing a category fills the location with the category's location: the one set in settings,
  or else the shelf where most items of that category already sit. It can still be changed per
  item.

### 5c. Material from the BOM list

- Plates, tubes and filament pick their material from the same list the BOM uses
  (`src/config/materials.ts`), as a filterable dropdown. A BOM part and its stock then share one
  name.
- **On the part card:** in View mode, tapping the material pill opens Inventory filtered to that
  material, showing how many sheets or tubes are in stock. In Edit mode the pill still opens the
  material picker, and a small "box" button beside it goes to Inventory.

## 6. Look and feel

Same language as the rest of the site: bigger buttons (44 px tap targets), chips for short
lists and type-to-filter dropdowns for long ones, the item cards in the shared card size and status tint, Jost headings, and press and
hover feedback (`press`, `card-interactive`). The add flow is one panel that stays open for the
next item, not a dialog per item.

## 7. Later (less urgent)

- **Camera photo.** On a phone, "Take photo" opens the camera directly (a standard file input
  with `capture`). The photo is uploaded to R2 as the thumbnail. Small and free, and could ride
  with round 2.
- **Barcode scan (improvement).** Many vendor bags carry a barcode or SKU. The phone camera can
  read it in the browser (Chrome on Android supports this natively; iPhone needs a small library),
  then search by it. This is often faster and more reliable than recognising a photo.
- **Recognise from a photo.** Doing it on the site would need a paid vision model on the server,
  against the $0 rule. The free path already exists: send the photo to your own Claude (or Gemini)
  with the OrbitMech connector and say "add this to inventory". It calls `add_inventory_items`
  with name, category and fields, and the item lands in To Review style for a quick check.

## 8. Order of work

| Round | What | Size |
|---|---|---|
| 1 | `inventory_categories` table + settings panel; part types and free material removed (one migration moves existing values); category locations; BOM material dropdown + material pill → Inventory; chip/dropdown custom add; bigger UI; smart typing; "Add another like this" | 1 PR |
| 2 | Add box with shelf matches; paste-a-link reader; auto photo to R2; `cots_links` on items; name opens the product; always-on auto-link into To Review | 1 PR |
| 3 | Live vendor search (after checking each vendor's endpoint) with a 1-day cache; part-number search | 1 PR |
| 4 | Camera photo and barcode scan | small |

Rounds 1 and 2 already deliver "instant" for anything with a link or a common spec. Round 3
makes typing a name enough.

## 9. Decided (Harel, 2026-10-23)

- Category fields are editable on a settings screen that feels embedded and stable.
- Long option lists stay dropdowns, made easy to navigate; chips only for short ones.
- A category points to a shared location.
- Plates, tubes and filament use the BOM material list; the material pill on part cards links to
  Inventory (View mode tap, Edit mode small button).
- Auto-link is always on, and its changes go to To Review like AI changes.

## 10. Still open

1. **Vendors:** which vendors the search should cover (the list in §3 is my guess).

## 11. After "Go" (Harel, 2026-10-23 10:54) — handed to the Inventory upgrade thread

Harel's "Go" came with three more answers:
- Clicking a material on a part card, or anything tied to inventory, opens a **closable window**
  with the relevant information. It doesn't navigate to the Inventory page.
- Vendors: the FRCDesignLib vendors, plus AliExpress and Amazon if possible.
- When search finds the same product at several vendors, the user picks one vendor, like a Google
  results list.

Vendor checks done so far (2026-10-23, through a web fetch; the dev container itself can't reach
vendor sites):
- **Shopify `/search/suggest.json?q=…&resources[type]=product` works (JSON with title, url,
  image, price):** WCP (wcproducts.com), AndyMark (andymark.com), ThriftyBot
  (thethriftybot.com), SDS (swervedrivespecialties.com).
- **Blocked to automated fetch (robots disallowed):** REV (revrobotics.com), goBILDA
  (gobilda.com). These go through paste-a-link only, or the member's AI.
- Redux (shop.reduxrobotics.com) returned a client error; not checked further. CTRE's store
  (store.ctr-electronics.com) looks like BigCommerce; not checked.
- Amazon and AliExpress have no free search API and block scraping. The plan for them: a "Search
  on Amazon / AliExpress ↗" row that opens their search with the query, and the paste-a-link
  reader for the link (Amazon may still block that fetch, so fall back to the title in the URL).

No code was written in the To Review thread; nothing is on a branch for this yet.

## 11. Built (2026-10-23, branch `claude/project-thread-lgd1bu`, PR #37)

Rounds 1–3: `inventory_categories` + settings panel (migrations 0020/0021, part types and material
removed); add box with shelf matches, Shopify vendor search (WCP, AndyMark, TTB, SDS, CTRE, Redux,
VEX) + BOM COTS links, grouped per product with store choice; paste-a-link reader; smart typing;
chips / type-to-filter dropdowns; category location; add another; product photo to R2; name opens
product; auto-link into To Review; closable inventory window everywhere. REV / AliExpress / Amazon
only via "search there, paste the link". Not built: picture per category, drag reorder (↑ ↓ instead),
camera/barcode (round 4). Live store search not yet tried from the live site.
