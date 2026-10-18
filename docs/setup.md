# Setting up the accounts

Everything belongs to a team or mentor Google account, not a student's, so it outlives
graduation. Steps marked **(Harel)** need the Onshape Enterprise admin.

## 1. Supabase (database and sign-in)

1. Create a free project at supabase.com. Pick the region closest to Israel (e.g. Frankfurt).
2. **Project Settings → API**: copy the Project URL and the publishable key into
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. **Connect → ORMs**: copy the transaction pooler string (port 6543) into `DATABASE_URL` and the
   session pooler string (port 5432) into `DIRECT_URL`.
4. Run `npm run db:migrate` with those values in `.env.local`.

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
   `ADMIN_EMAILS` holds the first admin's Google email. `CRON_SECRET` is any long random string.
3. Deploy. The daily keep-alive cron in `vercel.json` starts on its own.

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

**OAuth app (Harel, for the sync milestone):**
1. dev-portal.onshape.com → **OAuth applications → Create new OAuth application**.
   - Name: OrbitBOM. Primary format: `com.team1690.orbitbom`.
   - Redirect URLs: `https://<vercel-url>/api/onshape/callback` and
     `http://localhost:3000/api/onshape/callback`.
   - Scopes: **Read** and **Write** (Write is only for pushing part names back to Onshape).
2. Send the client ID and secret privately; they go into Vercel as `ONSHAPE_CLIENT_ID` and
   `ONSHAPE_CLIENT_SECRET`.
3. As Enterprise admin, allow the application for the Enterprise so students can connect it.

## 6. Cloudflare R2 (files milestone)

Not needed yet. When files land: create an R2 bucket and an API token scoped to it.
