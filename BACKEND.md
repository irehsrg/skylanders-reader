# Backend setup (Supabase)

The app works fully offline with no backend (local IndexedDB). To enable
**accounts + cross-device sync**, connect a free Supabase project. The web app
stays a static site — the browser talks to Supabase directly.

You do these steps (they need an account and credentials, which I can't create
for you). It takes about 5–10 minutes.

## 1. Create the project
1. Sign up at <https://supabase.com> and create a new project.
2. Wait for it to finish provisioning.

## 2. Create the tables
- Dashboard → **SQL Editor** → **New query**.
- Paste the contents of [`supabase/schema.sql`](supabase/schema.sql) and **Run**.
- This creates the `owned` and `wishlist` tables (row-level secured to each
  user) and a public `figure-images` storage bucket.

## 3. Enable sign-in methods
Dashboard → **Authentication** → **Providers**:
- **Email** — enable. (For quick testing you can turn off "Confirm email" so
  password sign-up logs you in immediately; magic links still email a link.)
- **Google** — enable, then follow Supabase's prompt to add a Google OAuth
  client ID/secret (from the Google Cloud console). Add your site URL and the
  Supabase callback URL to the Google client's authorized redirect URIs.

Dashboard → **Authentication** → **URL Configuration**: set the **Site URL** to
where you run the app (e.g. `http://localhost:5173` for dev, and your real
domain for production), and add both as redirect URLs.

## 4. Point the app at your project
1. Dashboard → **Project Settings** → **API**. Copy the **Project URL** and the
   **anon / public** key. (These are safe in frontend code. Never use the
   `service_role` secret in the app.)
2. In the repo root, copy `.env.example` to `.env` and fill them in:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
3. Restart `npm run dev`. A **Sign in** button now appears in the header.

## How sync works
- Signed out: collection lives only in this browser (IndexedDB).
- On sign-in: your cloud and local collections are **merged** (union — nothing
  is lost; duplicate copies are deduplicated by tag UID), then written back up.
- After that, every scan and wishlist change is written through to the cloud
  immediately, so other devices stay in sync on their next load.

## Images (later)
The `figure-images` bucket is created but empty. Figure art will be uploaded
there and referenced by `charId-variantId.webp`; until then the app shows
generated placeholder tiles. (Populating the bucket is a separate step.)
