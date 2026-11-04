# OrbitBOM redesign plan (draft v0)

Status: planning only, no code until Harel agrees. Open questions at the bottom decide the rest.

## What the site looks like today (surveyed 2026-10-20, main @ 719c668)

- **Look:** dark slate UI copied from FRCBOM, indigo accent, Geist font, Tailwind v4. Shared styles are only five classes in `src/app/globals.css` (`panel`, `btn`, `btn-primary`, `btn-danger`, `input`, `label`); everything else is inline Tailwind per component, so colours and spacing drift between screens.
- **Shell:** left sidebar (Build: Home, My Parts, Part Groups · Shop: Inventory · Team: Members, Profile), collapses to a scrolling top bar on mobile.
- **Screens (14 pages):** Home (robots list), Robot (systems + inventory panel), System BOM (card / table / kanban + bulk edit, merge, group bars), Main assembly, New robot, My Parts, Part Groups, Inventory (+ item, import, to-BOM dialogs), Members, Profile (MCP tokens), Login, Pending, Onshape connect, Onshape side panel.
- **Biggest components:** BomView, PartCard, InventoryView, fields/Popover editors, GroupsView, ItemDialog (~300 lines each).
- **Constraint from the repo rules:** CLAUDE.md says BOM, inventory and Onshape *behaviour* copy FRCBOM and must not be redesigned. A redesign therefore needs Harel to either keep behaviour and change only the look, or lift that rule.

## Proposed approach (to confirm)

1. Agree direction (answers below) and capture it as a short design spec: colours, type, spacing, component list.
2. Build a design-token layer in `globals.css` and a small component set (Button, Input, Select, Card, Badge/StatusPill, Dialog, Table, Tabs, Sidebar) so every screen draws from one place.
3. Mock the 3 core screens first (System BOM, Part card, Inventory) as a static page for Harel to approve before touching the app.
4. Restyle screen by screen behind the same routes, one PR, shipped in this order: shell + tokens → System BOM + part card → Inventory → the rest.
5. No database, Onshape or MCP changes unless Harel's answers ask for them.

## Open questions for Harel

1. Scope: look only (same screens and flows, new visuals), or also change layout and how screens work?
2. What bothers you most today? (e.g. cluttered part cards, hard to scan BOM, mobile, slow-feeling, looks generic)
3. Visual direction: keep dark, go light, or both with a toggle? Team colours / Orbit branding to use?
4. Main device in the shop: laptop, phone, or shop-floor tablet?
5. Any site you'd like it to feel like (Linear, Notion, Onshape, FRCBOM but cleaner...)?
