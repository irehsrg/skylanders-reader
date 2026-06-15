# Deploying to Vercel

The web app is a static Vite site, so Vercel hosts it directly. The **cloud
features work fully when hosted**: catalog, collection, wishlist, accounts, and
sync (any device, signed in, sees the same collection).

**Scanning is local-only by nature.** The portal helper talks to USB hardware,
so it runs on the user's machine, not Vercel. The hosted page reaches it at
`ws://127.0.0.1:8777`. See "Scanning from the hosted site" below.

## 1. Push to GitHub
```powershell
gh repo create skylanders-reader --private --source=. --remote=origin --push
```

## 2. Import to Vercel
- vercel.com → Add New → Project → import the GitHub repo.
- Framework preset auto-detects **Vite** (vercel.json pins it). Build
  `npm run build`, output `dist` — no changes needed.

## 3. Environment variables (Vercel → Settings → Environment Variables)
Add to **Production** and **Preview**:
```
VITE_SUPABASE_URL=https://opqnhckurkrawlunocfw.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...   (the publishable/anon key — safe to expose)
```
Do NOT add the `SUPABASE_SERVICE_KEY` — that's local-only for image uploads.
Redeploy after adding them (env vars bake in at build time).

## 4. Point Supabase at the deployed URL
Supabase → Authentication → URL Configuration:
- **Site URL**: your Vercel production URL (e.g. `https://skylanders-reader.vercel.app`).
- **Redirect URLs**: add the production URL and `https://*.vercel.app/**` so
  preview deploys can sign in too.

(Google OAuth itself needs no change — Google redirects to the Supabase
callback, which is already registered. Only Supabase's redirect allowlist needs
the app URL.)

## Scanning from the hosted site
The hosted site is HTTPS; the helper serves plain `ws://127.0.0.1:8777`.
Browsers treat loopback (127.0.0.1) as a secure origin, so this often works —
but Chrome's Private Network Access checks can block an HTTPS page from opening
a connection to a local server. **Verify after deploy:** run the helper, open
the hosted site, and check whether it logs "Connected to local portal helper."

If it's blocked, the reliable options are:
- Run locally for scanning (`npm run dev` + helper, open `http://localhost:5173`).
- Or have the helper also serve the built UI on `http://localhost:8777` (same
  origin as the socket — no mixed-content / PNA issue). Not yet implemented.

## Note on distributing the helper
Today the helper needs Node + `npm install`. For other users, it should be
packaged as a single executable (e.g. with `pkg`/`node --sea`) so they don't
need a toolchain. Future work.
