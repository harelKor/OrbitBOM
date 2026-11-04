# COTS Released & Order List: plan

Section 3 of Harel's 2026-10-24 list. Nothing gets built until Harel approves. After approval it is pushed straight to main.

## 1. Search bar next to "Send to order" (Released)

- I reuse the Inventory page's search box as it is. As you type it shows items already on the shelf, products from the team's stores, smart typing ("36t htd 1/2 hex pulley") and a chip per category for a custom item. A pasted product link gets read too.
- Next to the box there is a small **"Add to: General / <robot>"** picker. It defaults to General.
- **If you pick a shelf item**, a COTS card linked to that item is created in the chosen section with status Released.
- **If you pick a store product or a custom category**, the same add form as on Inventory opens. Saving it creates the inventory item (stock 0) and the linked COTS card in one step.
- The box only shows in Edit mode, like on Inventory.

**One data change is needed (your call).** Right now every part has to belong to a system, so "General" can't hold anything. My suggestion is that a part may have no system: cards added from the search get only a robot (that robot's section) or nothing at all (General). They show on the COTS pages and in the inventory usage, but not inside any system's BOM. The other option is a hidden "COTS" system created in each robot plus a hidden "General" robot. That needs no schema change, but those would appear in robot and system lists, so I don't recommend it.

## 2. Inventory sync (cards and items update each other)

I'll check and fix these, with a test for each:
- Renaming either the card or the item updates the other.
- Product links and price: a linked card shows the item's values, and editing them on the card writes to the item.
- Stock: −/+ on the card moves the item's stock (already true). The card's "x/y on shelf" and the In Stock status follow the shelf after each change.
- An order moving to In Stock adds its units to the item exactly once, including when it's undone and then set again.

## 3. "In Stock" section on Released

A collapsible "In Stock" section below "In order list", closed by default, with every in-stock COTS card in it.

## 4. Both pages

- **Smaller filter boxes.** They become a single row of compact tiles (small picture, label and count), about a third of their current height. They stay easy to tap, and you can scroll the row sideways on a phone.
- **"Vendors" toggle** next to Cards / Table. When it's on, the cards are grouped into collapsible sections by vendor (the site of the card's first product link, or "No vendor") instead of by robot. Each card still shows its robot and system. It works in both Cards and Table view.
- **In Stock clears itself.** A card leaves the In Stock sections a week after it reached In Stock, or right away when you press its **X**. This is shared by the whole team. It needs two new part fields: when the card reached In Stock, and when it was cleared. The part itself is kept, so this only hides the card.

## 5. Order List only

**Status filter boxes** go right beside the Vendors box: In Order List, Seen and In Route, each with its count and its status colour. Tap one to show only that status, tap it again to show everything.

## Not included
Nothing beyond the list. No changes to the BOM, To Fab or the Inventory page itself.
