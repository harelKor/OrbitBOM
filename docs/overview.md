# OrbitParts: a guide for reviewers

Start here if you're new to this code, especially if you're an outside reviewer or an AI agent
other than Claude. It tells you what the app is, who uses it, how the pages fit together and
where the code lives. The detailed engineering notes (rules, helpers, gotchas, hosting) are in
[`CLAUDE.md`](../CLAUDE.md): despite its name, it applies to every contributor and every agent.

## What it is

OrbitParts (the repo and code say **OrbitBOM**) is FRC team 1690 Orbit's own web app. It tracks
the robot's **BOM** (bill of materials) from Onshape, every part through **manufacturing** ("To
Fab"), **ordering** of bought parts (COTS), the shop **inventory**, **CAD review** in a 3D viewer,
and **assembly** guides. It is modelled on FRCBOM (a commercial FRC BOM tool) and linked to the
team's Onshape CAD.

- **Live site:** https://orbitparts.duckdns.org. Google sign-in; new people must be approved by an
  admin.
- **Users:** high-school students and mentors on one FRC team. Most use phones in a noisy
  workshop (gloves, bad light, quick taps). CAD students and mentors use laptops. The screens
  are English; many members' names are in Hebrew, so text must handle both directions.
- **Owner:** Harel (student, solo developer with AI help). Everything must stay on **free tiers**.
- **Claude integration:** each member can drive the app from their own Claude through an MCP
  server (`/api/mcp/<token>`), with preview → confirm → apply for writes.

## Stack

Next.js 16 (App Router; `src/proxy.ts` instead of middleware; this version differs from older
Next: see `AGENTS.md`), React 19, Tailwind 4, Drizzle ORM + node-postgres on Supabase Free
(Postgres, Google sign-in), Cloudflare R2 for files (3D meshes, drawings, photos), three.js for
3D, vitest. Hosted on one Oracle Cloud Always Free ARM VM (1 OCPU, 6 GB) behind Caddy, deployed by
GitHub Actions, or by hand when Actions minutes run out (see `CLAUDE.md`).

## Words the app uses

| Word | Meaning |
|------|---------|
| Robot | One season's robot (e.g. "Blitzer"). Has systems. |
| System | A subsystem (drivetrain, intake…) linked to an Onshape assembly. |
| Final / Basepart | A system's two Onshape models. **Final** = the assembly the BOM comes from. **Basepart** = an earlier Part Studio / assembly used only for 3D and comments. |
| Part | A BOM row: made in-house, or **COTS** (bought). Has quantity, material, machines (process 1/2), counters of how many are done, and a **status**. |
| Status | Computed by `computeStatus` (`src/lib/status.ts`) from the stored status and the done counters. In-house: Not Started → Released → Gcoded → In Process 1 → Ready for Process 2 → Post Processing → Ready for QA → In Stock (+ Reproduction, Spare…). COTS: Not Started → Released → In Order List → Seen → In Route → Arrived → In Stock. Lists in `src/config/statuses.ts`, `src/config/cots.ts`. |
| Release | CAD marks a part ready to make. Its CAD version is locked (`fabLock`), so later CAD edits show as "Changed". |
| To Fab | Making parts. Three areas: **Shop Fab** (own machines: laser, CNC, lathe…), **3D Printing** (team printers), **Factory Fab** (partner factories, e.g. Zivudim). Machines in `src/config/machines.ts`. |
| Batch | A group of parts cut together on one machine, from one material (Auto Layout nests them on a sheet; exports DXF, STEP, G-code). |
| Orders (COTS) | Bought parts: the **Released** list → **Order List** → arrives → shelf. Order History per vendor. |
| Inventory | The shop's shelf: items in categories (COTS & Motion, Raw Stock, Hardware, Electrical, Tools…), with stock counts, places, conditions, season needs. Sheets are counted in pieces (¾ of a sheet). |
| Raw stock | Plates, tubes and shafts that in-house parts are cut from. A part's material *is* an inventory item. |
| Place / Shop map | Where an item lives: a zone on the workshop floor plan, or a spot (drawer, shelf, bin) in a zone's photo. The map never shows place names, on purpose. |
| Version | A committed snapshot of a system's BOM, or of its CAD ("V12", "V12 v1"); made through Check → Commit. |
| CAD page | The whole robot in 3D with comments pinned to parts, a version tree, Design check (weight, frame perimeter, interference…). |
| Assembly page | Step-by-step build guide per sub-assembly, with pictures and ticks. |
| To Review / AI review | Changes made automatically (by "Suggest setup" or a member's Claude) waiting for a person to approve. |
| AI logs | Every change a member's Claude made, with Revert. |
| Recent actions | The member's own recent edits, with Undo / Revert. Ctrl+Z works too. |
| Recently deleted | Deleted robots, systems, parts and items, kept 30 days (Settings). |
| Onshape panel | A small page that runs *inside* Onshape (`/onshape/panel`) to link and sync systems. |

## Who can do what

Every member has a **mode** (`src/components/shell/mode.ts`):

- **Edit**: admins; everything, including settings and deletes. Admins can also preview the app
  as CAD or Build.
- **CAD Team**: design side: release parts, sync from Onshape, drawings, merges, assembly steps,
  Design check.
- **Build Team**: shop side: statuses, counters, materials, stock, batches.
- **none**: read-only (approved, but no team yet).

The capabilities (`work`, `draw`, `review`, `sync`, `classify`, `shape`, `instruct`, `check`,
`manage`) are checked by **every** server action, route and MCP tool on the server, not just
hidden in the UI.

## Pages

| URL | What it's for | Main users |
|-----|---------------|------------|
| `/` | Home: tiles into BOM, Inventory, Orders, CAD | everyone |
| `/robots/<id>` | Robot dashboard: To Fab counts, status breakdown, 3D status view, systems | everyone |
| `/robots/<id>/systems/<id>` | A system's BOM: cards / list / table / Kanban, part window, bulk edit, Update from Onshape | CAD, Build |
| `/robots/<id>/fab` | Shop Fab: parts and batches by machine; count parts made; Auto Layout | Build |
| `/robots/<id>/printing`, `/printing/<printer>` | 3D Printing per printer | Build |
| `/robots/<id>/factory`, `/factory/<factory>` | Factory Fab per partner factory | Build, mentors |
| `/robots/<id>/cad-review` | CAD page: 3D, comments, versions, Design check (`?system=` isolates one system) | CAD, mentors |
| `/robots/<id>/assembly` | Assembly guide | Build |
| `/robots/<id>/review` | To Review (automatic changes to approve) | CAD |
| `/robots/<id>/inventory` | What this robot draws from the shelf; raw-stock planner | Build, mentors |
| `/cots`, `/cots/<list>`, `/cots/history` | Orders: Released, Order List, Order History | ordering lead |
| `/inventory` (+ `/c/<category>`, `/condition/<id>`, `/location/<id>`) | Inventory: cards / list / table, add box, Scan (phones), map | everyone |
| `/ai-logs` | Changes made by members' Claude | admins |
| `/members`, `/profile`, `/settings` | Team, own profile (MCP token, Onshape connect), app settings (categories, places, map, backups, recently deleted) | admins / everyone |
| `/onshape/panel` (+ `/comments`, `/geometry`) | Runs inside Onshape | CAD |
| `/login`, `/pending`, `/invite/<token>` | Sign-in, waiting for approval, invites | new people |
| `/dev/viewer`, `/dev/shop-map`, `/dev/assembly` | Sandboxes (local dev only; 404 in production) | developers |

Some old URLs only redirect (`/reviews`, `/robots/<id>/main`, `/systems/<id>/cad-review`).

## Where the code lives

```
src/app/(app)/        pages behind sign-in, and their server actions (*-actions.ts, actions.ts)
src/app/api/          route handlers (GET reads, uploads, 3D model, cron, MCP, Onshape)
src/app/onshape/      the Onshape panel and connect flow
src/components/       UI by area: bom, fab, inventory, cots, review (CAD page), viewer (3D),
                      check (Design check), versions, assembly, map, shell (nav, modes), ui (primitives)
src/lib/              server logic by area: parts (edits, undo), inventory (stock moves),
                      onshape (API client + budget), sync, versions, model (3D builds), check,
                      reviews, mcp, data (page loaders + cache), storage (R2, backups), auth/mode
src/config/           fixed lists: statuses, machines, materials, Onshape budget, API limits
src/db/schema.ts      the whole database schema (Drizzle); drizzle/ holds the migrations
deploy/               server setup, release, backup scripts; .github/workflows/deploy.yml
plan/                 design notes per feature (historical: the code wins when they disagree)
docs/                 runbook (operations), setup, this guide
```

The shared helpers every change must go through (part edits, stock moves, deletes, Onshape calls,
versions) are listed in `CLAUDE.md` → "Where to make a change".

## Constraints that shape the design

- **Free tiers:** Supabase egress (5 GB/month; it ran out once, so whole-table reads are cached in
  server memory), Onshape API calls (10,000 a year shared by the team, so every call is counted and
  budgeted), GitHub Actions minutes (private repo), R2 storage, Serper/Gemini daily caps.
- **One small server:** heavy work (3D meshes, nesting, pictures) runs in the user's browser.
- **FRCBOM parity:** BOM, inventory and Onshape behaviour copy FRCBOM on purpose; don't
  redesign them.
- **Phones first** for shop pages: 36–40 px touch targets, readable in light and dark themes.

## Audits

- `plan/audit-2026-11-14.md`: full code and live-site audit, with a status section saying what
  has been fixed since (most of it) and what's still open.
- `docs/external-audit-prompt.md`: the brief given to outside AI reviewers.
