# Portal Tracker

**A free, browser-native Skylanders collection tracker.** Drop figures on a real
Portal of Power and they identify themselves — no manual checklist, no install,
no account required to browse.

🌐 **Live:** https://skylander-reader.vercel.app

Existing Skylanders trackers (PriceCharting, darkSpyro) are manual checklists,
and the figure *editors* (SkyReader, SkyEditGUI) are old desktop apps that are
hard to find and run. Portal Tracker is the first **browser-based** tool that
does live scanning **and** editing of figures you own, with zero install.

## What it does

- **Live scan** — place figures on your USB Portal of Power; they're identified
  and added to your collection automatically (up to 16 at once on the tray).
- **Track completion** — per-game progress across every Skylanders game,
  duplicate counting by physical tag, and a wishlist for what's next.
- **Edit what you own** — adjust gold, XP, hero points, or nickname, or factory-
  reset a figure. Always backed up and verified block-by-block before writing.
- **Accounts & sync** (optional) — sign in and your collection follows you across
  devices. Fully usable offline too (local storage + JSON export/import).
- **Community requests** — suggest missing figures and upvote others'.

## The interesting part: reading USB hardware from a browser tab

Identification works over **WebHID**. The catch, found the hard way on real
hardware: the common console portal (`1430:0150`) only accepts commands via a USB
**control transfer** (SET_REPORT), but Chromium's WebHID on Windows implements
`sendReport` as an interrupt-OUT `WriteFile` only — which the portal *stalls*. So
in-browser you get figure **detection** but not identification on that portal/OS.

To make it work everywhere, scanning can run through a tiny local helper (the
**Portal Station**) that uses the same control-pipe path desktop tools use, and
serves the web UI over `http://localhost` so there's no HTTPS/mixed-content
issue. On portals/platforms where WebHID's write path works, no helper is needed.

## Using it

- **Browse & track anywhere** — open the site, sign in, build your collection. No
  portal needed.
- **Scan (Windows)** — download the free **Portal Station** from the
  [Releases](https://github.com/irehsrg/skylanders-reader/releases/latest), unzip,
  plug in your portal, run `Start Portal.bat`, and open `http://localhost:8777`.

### Requirements

- A Chromium browser (Chrome/Edge) on **desktop** for the in-browser WebHID path
  (not available in Firefox, Safari, or on mobile — browsing still works there).
- A USB Portal of Power (any Skylanders game generation).

## Tech

Vanilla TypeScript + Vite, static-hosted on Vercel. Optional Supabase backend for
accounts, cross-device sync, figure art, and community requests (see
[BACKEND.md](BACKEND.md)) — without it the app runs local-only. Figure IDs seeded
from [Texthead1/Skylander-IDs](https://github.com/Texthead1/Skylander-IDs) and
curated. MIT licensed.

```sh
npm install
npm run dev      # dev server (localhost is a secure context for WebHID)
npm run build    # typecheck + production build to dist/
npm start        # build + run the local Portal Station helper
```

> Note: `npm run build-db` regenerates `src/figures/figures.json` from the raw ID
> dump and will clobber the curated figure list — don't run it unless you mean to.

## How identification works

1. **Connect** calls `navigator.hid.requestDevice` filtered to Activision's
   vendor ID `0x1430`.
2. Send `R` (Ready) to confirm the portal, then `A` (Activate).
3. The portal streams `S` (Status) packets ~50×/sec; 2 bits per slot encode figure
   presence. Transitions are debounced.
4. On an ADDED transition, send `Q` (Query) for block 1 of that figure — character
   ID and variant ID live there **unencrypted** — and look the pair up in the
   figure database. (Editing additionally uses AES-128, derived per the
   open-source SkyReader scheme, only for figures you own.)

## Legal

Free, open source (MIT), non-commercial. **Not affiliated with or endorsed by
Activision.** Skylanders, Spyro, and related characters are trademarks of
Activision Publishing, Inc. This tool reads and edits only figures you physically
own; it does not and will not support cloning figures onto blank tags.
