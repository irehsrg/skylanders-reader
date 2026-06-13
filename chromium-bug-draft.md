# Chromium bug draft — file at https://issues.chromium.org (component: Blink>HID)

**Title:** WebHID: sendReport() hangs forever on Windows for devices that only
accept output reports via the control pipe (Set_Report)

## Summary

On Windows, `HIDDevice.sendReport()` is implemented with `WriteFile`
(`services/device/hid/hid_connection_win.cc`, `PlatformWrite`). When the
target device has an interrupt OUT endpoint but its firmware does not service
it (it STALLs the transfer), the first write fails with a generic
`NotAllowedError` and every subsequent `sendReport()` promise never settles —
no resolution, no rejection, no timeout.

The Windows HID API offers `HidD_SetOutputReport` /
`IOCTL_HID_SET_OUTPUT_REPORT`, which delivers the output report as a
Set_Report request on the control pipe. Native applications use it as a
workaround for exactly this class of device. WebHID exposes no equivalent, so
these devices are unusable from the web on Windows (they may work on other
OSes whose HID stacks fall back to the control pipe).

Suggested fix: fall back to `IOCTL_HID_SET_OUTPUT_REPORT` when `WriteFile`
fails, or expose the choice; at minimum, fail the promise instead of leaving
it pending forever.

## Reproduction device

Activision Skylanders "Portal of Power" (console version), vendor `0x1430`,
product `0x0150`. HID report descriptor: vendor usage page 0xFF00, one input
report (ID 0, 32 bytes), one output report (ID 0, 32 bytes), no feature
reports. lsusb shows interrupt EP1 IN + EP1 OUT, but the firmware only
accepts commands as control-pipe Set_Report (bmRequestType 0x21, bRequest
0x09, wValue 0x0200, wIndex 0) — documented in
https://skylandersnfc.github.io/Docs/Skylanders_Portal_Demystified/ and
worked around in native tools, e.g.
https://github.com/capull0/SkyDumper/blob/master/hid_win.c (replaces
hidapi's WriteFile-based hid_write with HidD_SetOutputReport).

## Steps to reproduce

1. On Windows 11, Chrome (reproduced June 2026), connect the portal via USB.
2. `const [d] = await navigator.hid.requestDevice({filters:[{vendorId: 0x1430}]}); await d.open();`
3. `const pkt = new Uint8Array(32); pkt[0] = 0x52; await d.sendReport(0, pkt);`
4. First call rejects with `NotAllowedError: Failed to write the report.`
5. Call `sendReport` again: the promise stays pending forever (observed > 45 s),
   even after `close()`/`open()` cycles. Only replugging the device resets it.

Input reports are unaffected: the device streams ~78 input reports/sec
throughout.

## Expected

Either the output report is delivered via the control pipe (matching the
device's requirement and `HidD_SetOutputReport` semantics), or the promise
rejects promptly.
