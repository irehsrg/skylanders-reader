// Parses skylander-ids.md (from github.com/Texthead1/Skylander-IDs) into
// src/figures/figures.json. Re-run with `npm run build-db` after updating
// the markdown source.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(join(root, 'skylander-ids.md'), 'utf8');

const figures = [];
let section = null;

for (const line of md.split(/\r?\n/)) {
  const heading = line.match(/^### (.+)$/);
  if (heading) {
    section = heading[1].trim();
    continue;
  }
  if (!section) continue;

  const cells = line.split('|').map((c) => c.trim());
  if (cells.length < 3) continue;
  if (cells[0] === 'Skylander' || /^-+$/.test(cells[0].replace(/\s/g, ''))) continue;

  const charId = Number.parseInt(cells[1], 10);
  const variantId = Number.parseInt(cells[2], 10);
  // Rows with "?" IDs are unknown/unconfirmed — skip them.
  if (!Number.isInteger(charId) || !Number.isInteger(variantId)) continue;

  figures.push({ name: cells[0], charId, variantId, section });
}

const out = join(root, 'src', 'figures', 'figures.json');
writeFileSync(out, JSON.stringify(figures, null, 1) + '\n');
console.log(`Wrote ${figures.length} figures to ${out}`);
