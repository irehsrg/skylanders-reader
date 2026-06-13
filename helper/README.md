# Portal Tracker — local helper

A tiny local bridge that lets the web app fully read figures from console
Skylanders portals on Windows, which the browser alone can't do.

## Why this exists

Console portals (USB product ID `0150`) only accept commands as a USB
**control transfer** (`HidD_SetOutputReport` / Set_Report). Chrome's WebHID on
Windows only writes via the interrupt OUT endpoint, which these portals stall —
so the browser can *detect* figures but can't *identify* them. This helper does
the writes the way SkyReader/SkyEditGUI do, and streams identified figures to
the web app over a localhost WebSocket.

## Run it

```sh
cd helper
npm install
npm start
```

Leave the window open, plug in your portal, and open the web app. The app
auto-detects the helper (`ws://127.0.0.1:8777`) and switches to full
identification. Stop the helper and the app falls back to browser detect-only.

`npm run probe` is a one-shot CLI that identifies whatever figure is on the
portal and exits — handy for testing without the web app.

## How it works

- `node-hid` enumerates the portal and reads the input stream (status +
  command responses).
- `koffi` calls Win32 `CreateFileW` + `HidD_SetOutputReport` to send commands
  over the control pipe. The write handle is opened **GENERIC_WRITE only** so
  node-hid stays the sole reader (a second reader starves the status stream).
- On connect it sends `R` (Ready) then `A` (Activate); the portal then streams
  `S` status ~65×/sec. Slot transitions are debounced; on a figure ADD it
  reads block 1, parses charID/variantID, and looks up the name.

No admin rights, no driver install, no compiler — koffi and node-hid ship
prebuilt binaries.
