# Portal Tracker

A free, browser-based Skylanders collection tracker that reads figures **live**
off a real Portal of Power using WebHID — no install, no account.

**Status: working prototype, hardware-verified.** Live read + identify works
end to end (verified on a console portal `1430:0150`, Windows 11, Chrome).

Console portals only accept commands via a USB control transfer, which
Chrome's WebHID can't send on Windows (it stalls the interrupt OUT endpoint).
So there are two modes:

- **Browser only** — connect and *detect* figure presence. Identification is
  blocked by the Chromium limitation above (see `chromium-bug-draft.md`).
- **With the local helper** (`helper/`) — full identification, using the same
  control-pipe write path as desktop tools like SkyReader. Run `npm start` in
  `helper/`, then open the web app; it auto-connects and switches to full mode.

## Requirements

- Chrome, Edge, or another Chromium browser on **desktop** (WebHID is not
  available in Firefox, Safari, or on mobile).
- A USB Portal of Power (any Skylanders game generation).

## Develop

```sh
npm install
npm run dev      # dev server (localhost counts as a secure context for WebHID)
npm run build    # typecheck + production build to dist/
npm run build-db # regenerate src/figures/figures.json from skylander-ids.md
```

## How it works

1. **Connect portal** calls `navigator.hid.requestDevice` filtered to
   Activision's vendor ID `0x1430`.
2. The app sends `R` (Ready) to confirm the portal, then `A` (Activate).
3. The portal streams `S` (Status) packets ~50×/sec; 2 bits per slot encode
   figure presence. Transitions are debounced (~100 ms).
4. On an ADDED transition, the app sends `Q` (Query) for block 1 of that
   figure — character ID and variant ID live there **unencrypted** — and looks
   the pair up in a database of 691 figures seeded from
   [Texthead1/Skylander-IDs](https://github.com/Texthead1/Skylander-IDs).

## Legal

Free, open source (MIT), non-commercial. Not affiliated with or endorsed by
Activision. Skylanders, Spyro, and related characters are trademarks of
Activision Publishing, Inc. This tool reads and edits only figures you
physically own; it does not and will not support cloning figures.
