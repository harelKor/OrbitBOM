# OrbitParts (repo: OrbitBOM): notes for every agent

FRC team 1690's BOM, To Fab, ordering, inventory, CAD-review and assembly app, linked to Onshape.
Live at https://orbitparts.duckdns.org (Google sign-in, admin-approved members).

Read in this order:
1. `docs/overview.md`: what the app is, the words it uses, roles, every page, where the code lives.
2. `CLAUDE.md`: the detailed engineering rules, shared helpers, gotchas and hosting. It is named
   for Claude but applies to every agent and contributor; skip its first line (it includes this file).
3. `plan/audit-2026-11-14.md` §0: what the last full audit found, what's fixed and what's open.
4. `docs/runbook.md` for operations; `plan/<feature>.md` for design notes (historical: the code wins).

Hard rules, in short: everything stays on free tiers; never change production data or settings
without the owner's (Harel's) OK; never repeat secrets; part edits, stock moves, deletes and
Onshape calls go through the shared helpers listed in `CLAUDE.md`; the BOM, inventory and Onshape
behaviour copies FRCBOM and isn't to be redesigned.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
