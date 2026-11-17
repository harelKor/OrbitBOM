# Brief for an outside AI audit

Paste everything below the line into ChatGPT (agent mode). Before you start:

- **Code:** connect GitHub in ChatGPT and give it access to the private repo `harelKor/OrbitBOM`.
- **Live site:** best done with a separate Google account that you approve on Members and leave on
  **no team** (read-only), so nothing can change. To let it see Build or admin screens, sign it in
  as yourself, but stay with it. Sign in yourself when it hands you the browser; never give it a
  password.
- It must not press anything that spends the Onshape budget, Serper or Gemini credits, or changes
  data. The brief says so, but watch the first few minutes.

---

You are auditing **OrbitParts**, a web app built by FRC robotics team 1690 Orbit (high-school
students and mentors). It tracks the robot's BOM from Onshape CAD, manufacturing ("To Fab"),
ordering bought parts, the shop inventory, CAD review in a 3D viewer and assembly guides. Students
mostly use it on phones in a workshop; CAD students and mentors use laptops. One student builds it,
with AI help. It must stay entirely on free tiers.

**Sources**
- Code: GitHub repo `harelKor/OrbitBOM` (branch `main`). Read these first, in order:
  `AGENTS.md`, `docs/overview.md` (glossary, roles, every page, code map), `CLAUDE.md` (rules,
  shared helpers, gotchas, hosting), then `plan/audit-2026-11-14.md` §0 (the last audit: what was
  fixed on 2026-11-14 and what is known to be still open).
- Live site: https://orbitparts.duckdns.org. When you reach the Google sign-in page, stop and ask me
  to sign in; never type a password.

**Hard rules for the live site: look, don't touch**
- Don't save, delete, upload, or change any status, counter (− / +), stock, setting, member or
  comment. You may open windows and menus, then close them with Cancel / ✕ / Esc.
- Never press buttons that call outside services: Update BOM / Update system / Update CAD /
  Commit / Check, Update 3D model, Sync, Make drawing, Export STEP / DXF, Onshape Layout, Search
  the web, Scan / Lens, AI write-up, Suggest setup, anything in Settings → Backups, and
  `/onshape/panel`. They spend a small yearly Onshape API budget or paid credits.
- Use the read-only parts freely: navigation, search, filters, view switches (cards / list /
  table / Kanban), the 3D viewer (rotate, section, measure, hide), the shop map, theme slider.
- If anything asks for a confirmation, an account, a payment or a permission, stop and ask me.

**What to audit**
1. **Shop-floor usability on phones** (375 × 812, touch). For each main page (Home, robot
   dashboard, a system's BOM, Shop Fab, 3D Printing, Factory Fab, Orders, Inventory incl. the map,
   CAD page, Assembly), judge how fast a student finishes the common task: find a part and its
   status, see what to make next on a machine, find where an item lives on the shelf, check
   what's short. Look at touch target size, text size, contrast in **both** light and dark themes,
   empty / loading / error states, overflow, and confusing wording.
2. **Desktop and laptop** (1280 × 800): the same pages plus the CAD page's 3D viewer, the part
   window and the BOM table. Look for layout, density and keyboard use.
3. **Performance as a user feels it:** time to first content and to interactive per page, page
   weight (HTML/RSC payload, JS, images), 3D model load time, jank while scrolling.
   Record numbers.
4. **Accessibility:** keyboard reach, focus visibility, labels, roles, contrast ratios.
5. **Code review** (read the repo):
   - security: auth and capability checks in every server action, route handler and MCP tool;
     injection; SSRF; uploads; secrets;
   - data correctness: races, transactions, counters vs totals, undo, the cache invalidation in
     `src/lib/data/cache.ts`;
   - free-tier risks: Supabase egress, Onshape calls, Actions minutes, R2;
   - reliability: deploy, backup, migrations, errors;
   - structure: duplication, dead code, oversized components.
6. **Ideas:** features that would genuinely help an FRC team in build season and at competitions,
   tied to what already exists.

**Respect these decisions** (flag a conflict; don't "fix" it): the BOM, inventory and Onshape
behaviour deliberately copies FRCBOM; status always comes from `computeStatus`; the 3D view copies
Onshape's assembly view; the shop map hides place names on purpose; all heavy maths runs in the
browser because the server is a single small VM.

**Before reporting anything**
- Check it isn't already listed as fixed or open in `plan/audit-2026-11-14.md` §0. If it's listed
  as fixed but you still see it, report it as a **regression** with evidence. If it's listed as
  open, don't repeat it; you may add new evidence.
- Every code finding cites `path:line` from code you actually read on `main`. Every live finding
  gives the URL, the viewport, the theme and the steps, and what you saw.
- Say how sure you are. No generic advice ("add more tests", "use TypeScript").

**Report format** (one Markdown document)
1. **Top 15**: the most valuable fixes, ranked by harm × ease, one line each.
2. **Findings** grouped by area (Phone UX, Desktop UX, Performance, Accessibility, Security, Data
   correctness, Free tier, Reliability, Structure). Each finding has:
   - severity (high / medium / low) and a short title;
   - evidence: `path:line`, or URL + viewport + theme + steps;
   - why it matters to the team;
   - the suggested fix;
   - effort (S = hours, M = a day or two, L = more);
   - confidence.
3. **Regressions**: things §0 calls fixed that aren't.
4. **Measurements**: a table per page (viewport, load time, payload sizes, notes).
5. **Feature ideas**, grouped by who benefits (shop floor, manufacturing, mentors, CAD,
   platform), each with what it builds on and effort.
6. **Questions for the owner**: anything that's a product decision, not a bug.

Aim for 30–60 strong findings rather than hundreds of weak ones.
