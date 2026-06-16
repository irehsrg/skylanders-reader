// Assemble a portable, no-install Windows bundle of the portal helper.
//
// Produces build/portal-station/ containing a bundled Node runtime, the helper
// code + its native modules, the built web app, and a double-click launcher.
// A user unzips it and runs "Start Portal.bat" — no Node, no npm, no install.
//
//   npm run package-helper   (runs `npm run build` first)
//
// The layout mirrors the repo so the helper's relative paths (../dist,
// ../src/figures/figures.json) resolve unchanged.
import { cp, mkdir, rm, writeFile, stat, readdir } from 'node:fs/promises';
import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'build', 'portal-station');

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

// Remove prebuilt native binaries for platforms other than Windows x64 to
// shrink the bundle (koffi and node-hid ship binaries for many platforms).
// Keeps any directory whose name mentions win/windows + x64.
async function pruneNonWindows(modulesDir) {
  const isWinX64 = (n) => /win32/i.test(n) && /(x64|x86_64|amd64)/i.test(n);
  // koffi: node_modules/koffi/build/koffi/<platform>_<arch>/
  const koffiBuild = join(modulesDir, 'koffi', 'build', 'koffi');
  await pruneChildren(koffiBuild, isWinX64);
  // node-hid: node_modules/node-hid/prebuilds/<platform>-<arch>/
  await pruneChildren(join(modulesDir, 'node-hid', 'prebuilds'), isWinX64);
}

async function pruneChildren(dir, keep) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // path layout differs; skip rather than risk breakage
  }
  for (const e of entries) {
    if (e.isDirectory() && !keep(e.name)) {
      await rm(join(dir, e.name), { recursive: true, force: true });
    }
  }
}

async function main() {
  if (!(await exists(join(root, 'dist', 'index.html')))) {
    console.error('No dist/ build found. Run `npm run build` first.');
    process.exit(1);
  }
  if (!(await exists(join(root, 'helper', 'node_modules', 'node-hid')))) {
    console.error('helper/node_modules missing. Run `npm install` in helper/ first.');
    process.exit(1);
  }

  console.log('Cleaning output…');
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'helper'), { recursive: true });
  await mkdir(join(out, 'src', 'figures'), { recursive: true });

  console.log('Copying bundled Node runtime…');
  await copyFile(process.execPath, join(out, 'node.exe'));

  console.log('Copying helper code + native modules…');
  // Copy every helper module (server, portal, figure, crypto, …) so we never
  // miss one as the helper grows.
  const helperMjs = (await readdir(join(root, 'helper'))).filter((f) => f.endsWith('.mjs'));
  for (const f of helperMjs) await copyFile(join(root, 'helper', f), join(out, 'helper', f));
  await cp(join(root, 'helper', 'node_modules'), join(out, 'helper', 'node_modules'), { recursive: true });

  console.log('Trimming non-Windows native binaries…');
  await pruneNonWindows(join(out, 'helper', 'node_modules'));

  console.log('Copying web app + figure database…');
  await cp(join(root, 'dist'), join(out, 'dist'), { recursive: true });
  await copyFile(join(root, 'src', 'figures', 'figures.json'), join(out, 'src', 'figures', 'figures.json'));

  console.log('Writing launcher + readme…');
  // Launcher: run the bundled node against the helper, from the bundle root so
  // relative paths resolve.
  const bat =
    '@echo off\r\n' +
    'cd /d "%~dp0"\r\n' +
    'echo Starting Skylanders Portal Station...\r\n' +
    'echo Leave this window open, then open http://localhost:8777 in Chrome.\r\n' +
    'start "" http://localhost:8777\r\n' +
    'node.exe helper\\server.mjs\r\n' +
    'pause\r\n';
  await writeFile(join(out, 'Start Portal.bat'), bat);

  const readme =
    'Skylanders Portal Station\r\n' +
    '=========================\r\n\r\n' +
    '1. Plug in your Skylanders portal.\r\n' +
    '2. Double-click "Start Portal.bat".\r\n' +
    '3. Chrome opens http://localhost:8777 — drop figures on the portal.\r\n\r\n' +
    'Keep the black window open while using it. Close it to stop.\r\n' +
    'Windows 64-bit. No install needed.\r\n';
  await writeFile(join(out, 'README.txt'), readme);

  console.log(`\nDone: ${out}`);
  console.log('Zip that folder to distribute. Users unzip and run "Start Portal.bat".');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
