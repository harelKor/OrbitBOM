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
4. In Supabase, **Authentication → URL Configuration**: set Site URL to the Vercel URL and add
   `http://localhost:3000/**` and `https://<vercel-url>/**` to the redirect allow list.

## 3. Vercel (hosting)

1. Import the GitHub repo into a Vercel Hobby project.
2. Add the environment variables from `.env.example` (all except the Onshape test keys).
   `ADMIN_EMAILS` holds the first admin's Google email. `CRON_SECRET` and `MCP_SECRET` are any long random strings.
3. Deploy. The daily keep-alive cron in `vercel.json` starts on its own.
4. `vercel.json` pins the app's server functions to `bom1` (Mumbai), next to the Supabase
   database (ap-south-1). Every page makes several database queries, so a server on another
   continent adds a visible delay to each click. If the database moves, change `regions` to match.

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
   - Redirect URLs: `https://<vercel-url>/api/onshape/callback` and
     `http://localhost:3000/api/onshape/callback`.
   - Scopes: **Read** and **Write** (Write is only for pushing part names back to Onshape).
2. Put the client ID and secret into Vercel as `ONSHAPE_CLIENT_ID` and `ONSHAPE_CLIENT_SECRET`,
   and add `ONSHAPE_TOKEN_KEY` (generate it with `openssl rand -base64 32`).
3. As Enterprise admin, allow the application for the Enterprise so students can connect it.

## 6. Cloudflare R2 (part files, thumbnails, CAD exports)

Free tier: 10 GB stored, no download fees.

1. Cloudflare dashboard → **R2** → enable it (asks for a card, but the free tier isn't charged) → **Create bucket** named `orbitbom`, location Automatic.
2. Bucket → **Settings → CORS policy** → add this, with your real site address, so browsers can upload straight to the bucket:

   ```json
   [
     {
       "AllowedOrigins": ["https://YOUR-APP.vercel.app", "http://localhost:3000"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. R2 overview → **Manage R2 API Tokens** → **Create API token**: permission *Object Read & Write*, applied to the `orbitbom` bucket only. Copy the **Access Key ID** and **Secret Access Key** (shown once).
4. In Vercel → Settings → Environment Variables set `R2_ACCOUNT_ID` (the account id on the R2 overview page), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET=orbitbom`, then redeploy.

The bucket stays private: every download goes through `/api/files/…`, which checks the member is signed in and hands out a 5-minute link. Without these variables the app works, and file uploads say storage isn't set up.

## 7. Claude (MCP server)

Nothing to set up beyond `MCP_SECRET`. Each member opens **Profile → Use OrbitBOM from Claude**, creates a connector link and adds it in Claude under **Settings → Connectors → Add custom connector**. The link acts as that member; revoke it on the profile page if it leaks. Write tools always show a preview and apply only after the member agrees, and `undo_batch` reverts any applied change.
