# CLAUDE.md — Skylanders Portal Tracker

## What we're building
A free, web-based Skylanders collection tracker that reads figures **live** off a real Portal of Power over **WebHID**, identifies them, and tracks the user's collection. Optional figure-**editing** (stats/XP/nickname/reset) for figures the user owns. No checklist-only mode — scanning is the whole point and the differentiator.

**Differentiator:** Existing trackers (PriceCharting, darkSpyro, etc.) are manual checklists. Existing portal *editors* (SkyReader, SkyEditGUI) are old desktop apps that are hard to find/run. This is the first **browser-native** tool that does live read + edit with zero install.

## Hard scope rules
- **In scope:** read figure identity (live scan), track collection, edit data on figures the user physically owns (reset, stats, gold, nickname, hats).
- **Out of scope (do not implement):** cloning a figure's data onto blank/NUID tags, bulk dumping for distribution, anything that produces counterfeit figures. This is the line Activision historically litigated; stay on the "edit what you own" side.

## Tech stack
- Vanilla TS + Vite (no heavy framework needed). Static-hostable on GitHub Pages / Netlify (HTTPS = satisfies WebHID secure-context requirement).
- Persistence: IndexedDB. JSON export/import for backup. No backend, no accounts in v1.
- Zero paid dependencies. Open-source from day one (MIT).

## Hardware / protocol facts (verified — build against these)
- Portal enumerates as generic USB HID. **Vendor ID `0x1430`** (Activision), product ID `0x0150` (wireless/console dongle); wired PC/360 portal reports `0x1F17`. Filter on vendorId `0x1430` first.
- WebHID is **Chromium desktop only** (Chrome/Edge/Opera). Feature-detect `'hid' in navigator`; if absent, show a "use Chrome/Edge on desktop" message. No Firefox, Safari, or mobile — do not promise phone support.
- `navigator.hid.requestDevice({ filters: [{ vendorId: 0x1430 }] })` must be called from a **user gesture** (button click). Granted device persists across sessions.
- Command packets are 32 bytes; first byte is an ASCII command char. Commands sent via feature/output report (SET_REPORT path); responses arrive as `inputreport` events.
- Key commands:
  - **R** (Ready) — confirms portal, identifies model from response bytes.
  - **A** (Activate).
  - **S** (Status) — auto-emitted ~50×/sec; 2 bits per slot (up to 16 slots) signal present/added/removed. Debounce; act on ADDED transitions.
  - **Q** (Query) — reads one 16-byte block; block index is a parameter.
- **Figure identity is unencrypted.** In sector 0, **block 1**: character ID = 16-bit int at offset `0x00`, variant ID = 16-bit int at offset `0x0C`. No AES needed to *identify* a figure. The portal handles MIFARE auth; sector-0 Key A is a known constant `4B 0B 20 10 7C CB`.
- **Editing** stats/XP/nickname DOES require AES-128 ECB. Per-sector key = MD5 of (sector-0 bytes + block index + a constant Activision copyright string). Reference the open-source SkyReader / SkyEditGUI / mandar1jn-SkylandersToolkit implementations for the exact derivation — port, don't reinvent.

## Figure ID database
- Seed from **github.com/Texthead1/Skylander-IDs** (charID + variantID → name, across all 6 games incl. variants/traps/vehicles/crystals). Variant ID is a bitfield encoding game generation + flags (wow-pow, alt-deco, LightCore, SuperCharger).
- Store locally as JSON. Allow community PRs to fix/extend.

## Architecture
```
/src
  /hid        portal connection, command writer, status/query parser
  /figures    ID database + lookup (charID+variantID → figure)
  /crypto     AES key derivation (only loaded for edit mode)
  /collection IndexedDB store, owned/wishlist/dupe states, export-import
  /ui         scan view, collection grid, edit panel
```
Keep edit-mode crypto lazy-loaded and clearly gated behind "I own this figure" UX.

## Build order (do NOT do it all at once)
1. **HID connect + identify.** Button → requestDevice → Ready → Activate → log model. Prove the connection works on real hardware before anything else.
2. **Live read.** Listen to Status, on ADDED send Query(block 1), parse charID+variantID, look up name, show it on screen. This is the demoable milestone — the 20-second video.
3. **Collection tracking.** Auto-add scanned figures to an IndexedDB collection; owned/dupe/wishlist states; per-game/variant completeness %.
4. **Multi-figure scan.** Handle up to 16 slots so a tray of figures scans at once. (Killer feature vs. manual entry.)
5. **Edit mode.** AES derivation, read/write owned-figure data (reset, gold, XP, nickname). Heavy testing; gate behind explicit confirmation.

## Risks to surface early
- The SET_REPORT/feature-report command path has **no prior browser implementation** to copy — it's the riskiest unknown. Prototype the Query-block-1 round-trip against one real portal + figure in step 1/2 before building further.
- **VERIFIED 2026-06-12 on real hardware (console portal "Spyro Portal" 1430:0150, Windows 11, Chrome):** the portal STALLs its interrupt OUT endpoint; commands are only accepted as SET_REPORT on the control pipe (bmRequestType 0x21, bRequest 0x09, wValue 0x0200). Chromium's Windows backend implements `sendReport` with `WriteFile` only (interrupt OUT path, no fallback, no timeout) → first write after replug fails fast with NotAllowedError, subsequent writes hang forever. `sendFeatureReport` is rejected because the descriptor declares no feature reports. **Result: figure *detection* (S status stream, ~78 packets/sec observed) works; block reads (identification) and writes are impossible on this portal+OS combo.** Desktop tools work because they use HidD_SetOutputReport — see capull0/SkyDumper hid_win.c. Untested so far: PC portal (1F17 — reportedly accepts interrupt OUT writes with a `0B 14` prefix before the command char, so it may work in-browser), true wireless dongle (single IN endpoint — Windows should route WriteFile to the control pipe automatically, may just work), macOS/Linux Chrome. The app detects the hang signature (write pending + no R response at timeout) and falls back to a detect-only mode with an explanatory banner.
- Portal model edge cases: Xbox 360 wired portal has an Infineon security chip and may behave differently; Swap Force figures use two tags; some Imaginators/crystals have quirks. Detect model via Ready response and warn on unsupported ones.
- Trademark: "Skylanders"/"Spyro"/character names + art are Activision/Microsoft IP. Stay free/non-commercial, add a "not affiliated with Activision" disclaimer, avoid official logos, prefer user-photographed images.

## Definition of done for v1
A Chrome/Edge desktop user plugs in any USB portal, clicks Connect, drops figures on it, and watches them auto-identify and populate a persistent collection grid — no install, no account.

## Stretch (later)
- An **MCP server** wrapping the same HID layer so Claude can answer "what figure is on the portal right now?" — ecosystem-native and demoable.
- Price-data display, shareable public collection URLs, condition/boxed tracking.
