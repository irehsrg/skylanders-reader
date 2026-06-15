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
import { cp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'build', 'portal-station');

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
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
  await copyFile(join(root, 'helper', 'server.mjs'), join(out, 'helper', 'server.mjs'));
  await copyFile(join(root, 'helper', 'portal.mjs'), join(out, 'helper', 'portal.mjs'));
  await cp(join(root, 'helper', 'node_modules'), join(out, 'helper', 'node_modules'), { recursive: true });

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
