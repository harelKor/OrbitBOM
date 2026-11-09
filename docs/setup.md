# Setting up the accounts

Everything belongs to a team or mentor Google account, not a student's, so it outlives
graduation. Steps marked **(Harel)** need the Onshape Enterprise admin.

## 1. Supabase (database and sign-in)

1. Create a free project at supabase.com. Pick the region closest to Israel (e.g. Frankfurt).
2. **Project Settings → API**: copy the Project URL and the publishable key into
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. **Connect → ORMs**: copy the transaction pooler string (port 6543) into `DATABASE_URL` and the
   session pooler string (port 5432) into `DIRECT_URL`.
4. Create the tables: in GitHub → the repo → **Settings → Secrets and variables → Actions**, add
   the secret `PRODUCTION_DIRECT_URL` with the session pooler string (port 5432, password filled
   in). Then **Actions → Migrate database → Run workflow**. It also runs on its own whenever a new
   migration reaches `main`. (Or run `npm run db:migrate` locally with the values in `.env.local`.)

## 2. Google sign-in

1. In Google Cloud Console (under the team account), create a project, then
   **APIs & Services → OAuth consent screen**: External, app name "OrbitBOM".
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. In Supabase, **Authentication → Sign In / Providers → Google**: paste the client ID and secret,
   and enable it.
4. In Supabase, **Authentication → URL Configuration**: set Site URL to
   `https://orbitparts.duckdns.org` and add `http://localhost:3000/**` and
   `https://orbitparts.duckdns.org/**` to the redirect allow list.

## 3. Hosting (our own server)

Until 2026-11-06 the site ran on Vercel Hobby; its 4 Active-CPU-hours a month ran out and paused
it, so it moved to an Oracle Cloud Always Free VM in Mumbai (home region `ap-mumbai-1`, next to
the Supabase database: every page makes several queries, so a server on another continent adds a
visible delay to each click). Full steps and day-to-day commands: `docs/runbook.md` → "The server".

1. Oracle: one free VM (Ubuntu 24.04; Ampere A1 up to 2 OCPU / 12 GB, or the AMD
   `VM.Standard.E2.1.Micro`), public subnet with TCP 80/443 open, a quota policy capping compute at
   the free shapes, a $1 budget alert. Stay on the free account (the Pay As You Go upgrade puts a
   ~€93 hold on the card).
2. `deploy/setup.sh` over SSH (Node 22, Caddy, the `orbitparts` service, the daily keep-alive
   timer, 2 GB swap, user `orbit` for deploys).
3. A DuckDNS name pointing at the VM's IP (Caddy gets the HTTPS certificate itself).
4. `bash deploy/enter-secrets.sh <ip>` from Git Bash: GitHub deploy secrets plus each service's key
   (typed hidden, straight to the server). `CRON_SECRET`, `MCP_SECRET`, `ONSHAPE_TOKEN_KEY` are
   generated on the server; Actions → "Server env" adds the database URL; Actions → "Deploy".
5. **Background refresh** (off: `REFRESH.scheduled` in `src/config/refresh.ts` is false to save
   Onshape's yearly API allowance, so the route below answers `{ disabled: true }`): a free outside
   scheduler checks Onshape every 10 minutes (or add a systemd timer like the keep-alive one). At cron-job.org (free account) →
   **Create cronjob**: URL `https://orbitparts.duckdns.org/api/cron/refresh`, every 10 minutes, and under
   **Advanced → Headers** add `Authorization` = `Bearer <your CRON_SECRET>`. Each system is checked
   every 10 minutes during meeting hours (14:00–23:00 Israel time) and hourly otherwise, on the
   Onshape account of whoever last clicked Update BOM on it; a check costs one Onshape call and
   pulls the BOM only when the document changed. Hours live in `src/config/refresh.ts`.
   An open system page's check every few minutes is off too (`REFRESH.openPages`), so Onshape is
   only checked when a member clicks Update BOM.

## 4. Nightly backup

1. Create a **private** GitHub repo, e.g. `OrbitBOM-backups`.
2. Create a fine-grained token with *Contents: read and write* on that repo only.
3. In this repo's **Settings → Secrets and variables → Actions**, add `BACKUP_DATABASE_URL`
   (the session pooler string), `BACKUP_REPO` (`owner/OrbitBOM-backups`) and `BACKUP_REPO_TOKEN`.
4. Run the "Nightly backup" workflow once by hand to check it.

## 5. Onshape

**For the test (now):** create API keys at dev-portal.onshape.com/keys with read access, put them
in `.env.local`, and run `npm run onshape:test` on one real system's assembly URL. Copy the
property IDs it prints for Material, Pre Process, Process 1 and Process 2 into
`src/config/onshapeProperties.ts`.

**OAuth app (Harel; needed for Connect Onshape and Update BOM):**
1. dev-portal.onshape.com → **OAuth applications → Create new OAuth application**.
   - Name: OrbitBOM. Primary format: `com.team1690.orbitbom`.
   - Redirect URLs: `https://orbitparts.duckdns.org/api/onshape/callback` and
     `http://localhost:3000/api/onshape/callback`.
   - Scopes: **Read** and **Write** (Write is only for pushing part names back to Onshape).
2. Put the client ID and secret on the server as `ONSHAPE_CLIENT_ID` and `ONSHAPE_CLIENT_SECRET`
   (`deploy/enter-secrets.sh`); `ONSHAPE_TOKEN_KEY` is generated there.
3. As Enterprise admin, allow the application for the Enterprise so students can connect it.
4. **Panel inside Onshape:** in the same OAuth application, open **Extensions → Add extension**.
   - Name: OrbitBOM. Location: **Element right panel**. Context: **Selected assembly**.
   - Action URL:
     `https://orbitparts.duckdns.org/onshape/panel?server={$server}&documentId={$documentId}&workspaceOrVersion={$workspaceOrVersion}&workspaceOrVersionId={$workspaceOrVersionId}&elementId={$elementId}`
     (the version fields let a comment written in the panel go on the Onshape version open there;
     the older `workspaceId={$workspaceId}` URL still works, its comments go on the newest version)
   - Students then subscribe to the app (or it is granted to the Enterprise) and open the OrbitBOM
     icon on an assembly's right side. They sign in once in a popup; the sign-in lasts 60 days.

## 6. Cloudflare R2 (part files, thumbnails, CAD exports)

Free tier: 10 GB stored, no download fees.

1. Cloudflare dashboard → **R2** → enable it (asks for a card, but the free tier isn't charged) → **Create bucket** named `orbitbom`, location Automatic.
2. Bucket → **Settings → CORS policy** → add this, with your real site address, so browsers can upload to the bucket and load 3D models and
   files from it (a missing origin shows as "The 3D model couldn't load"):

   ```json
   [
     {
       "AllowedOrigins": ["https://orbitparts.duckdns.org", "http://localhost:3000"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. R2 overview → **Manage R2 API Tokens** → **Create API token**: permission *Object Read & Write*, applied to the `orbitbom` bucket only. Copy the **Access Key ID** and **Secret Access Key** (shown once).
4. On the server set `R2_ACCOUNT_ID` (the account id on the R2 overview page), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (`deploy/enter-secrets.sh`) and `R2_BUCKET=orbitbom`, then restart the app.

The bucket stays private: every download goes through `/api/files/…`, which checks the member is signed in and hands out a 5-minute link. Without these variables the app works, and file uploads say storage isn't set up.

## 7. Claude (MCP server)

Nothing to set up beyond `MCP_SECRET`. Each member opens **Profile → Use OrbitBOM from Claude**, creates a connector link and adds it in Claude under **Settings → Connectors → Add custom connector**. The link acts as that member; revoke it on the profile page if it leaks. Write tools always show a preview and apply only after the member agrees, and `undo_batch` reverts any applied change.
