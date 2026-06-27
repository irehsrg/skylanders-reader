// Assign SWAP Force *combined* figure art to both of its halves.
//
// Our DB tracks each swapper as two half-figures: bottom (charId 1000+i) and
// top (charId 2000+i), sharing the same variantId. skylanderscharacterlist has
// one photo of the assembled figure per combo (e.g. BlastZone.png). We give that
// photo to both halves — per the decision not to track upper/lower art separately.
//
//   node scripts/match-swap.mjs                       # report, write swap-matches.json
//   node --env-file=.env scripts/match-swap.mjs --upload
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const figures = JSON.parse(readFileSync(join(root, 'src', 'figures', 'figures.json'), 'utf8'));
const index = JSON.parse(readFileSync(join(here, 'scl-index.json'), 'utf8'));
const UA = 'Mozilla/5.0 (PortalTracker swap art; non-commercial fan tool)';

// i  ->  [topName, bottomName]; top charId = 2000+i, bottom charId = 1000+i.
const PAIRS = [
  ['Boom', 'Jet'], ['Free', 'Ranger'], ['Rubble', 'Rouser'], ['Doom', 'Stone'],
  ['Blast', 'Zone'], ['Fire', 'Kraken'], ['Stink', 'Bomb'], ['Grilla', 'Drilla'],
  ['Hoot', 'Loop'], ['Trap', 'Shadow'], ['Magna', 'Charge'], ['Spy', 'Rise'],
  ['Night', 'Shift'], ['Rattle', 'Shake'], ['Freeze', 'Blade'], ['Wash', 'Buckler'],
];
const STOP = new Set(['the', 'in', 'of', 'and', 'a', 'series', '1']);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const tokens = (s) =>
  s
    .toLowerCase()
    .replace(/quick draw/g, 'quickdraw') // "Quick Draw Rattle Shake" == "Quickdraw …"
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

// variantKey = the non-core, non-series tokens, normalized & order-independent.
// "Quick Draw" -> "quickdraw", "(Gold?)" -> "gold", base -> "".
function variantKey(allTokens, coreWords) {
  const core = new Set(coreWords.map(norm));
  return allTokens
    .filter((t) => !core.has(t) && !STOP.has(t) && t !== '?')
    .map((t) => t.replace(/\?/g, ''))
    .sort()
    .join('');
}

// Build (i#variantKey) -> image from the scl index.
const comboImg = new Map();
for (const e of index) {
  const tks = tokens(e.name);
  for (let i = 0; i < PAIRS.length; i++) {
    const [top, bot] = PAIRS[i];
    if (tks.includes(norm(top)) && tks.includes(norm(bot))) {
      const key = `${i}#${variantKey(tks, [top, bot])}`;
      if (!comboImg.has(key)) comboImg.set(key, { image: e.image, sclName: e.name });
      break;
    }
  }
}

// For each DB swap half, derive (i, variantKey) from its own name and look it up.
const matches = [];
const misses = [];
for (const f of figures) {
  const isBottom = f.charId >= 1000 && f.charId <= 1015;
  const isTop = f.charId >= 2000 && f.charId <= 2015;
  if (!isBottom && !isTop) continue;
  const i = f.charId % 1000;
  const core = isBottom ? PAIRS[i][1] : PAIRS[i][0];
  const key = `${i}#${variantKey(tokens(f.name), [core])}`;
  const hit = comboImg.get(key);
  if (hit) matches.push({ name: f.name, key: `${f.charId}-${f.variantId}`, image: hit.image, sclName: hit.sclName });
  else misses.push(f.name);
}

writeFileSync(join(here, 'swap-matches.json'), JSON.stringify(matches, null, 2));
console.log(`combo images found: ${comboImg.size}`);
console.log(`swap halves matched: ${matches.length}`);
console.log(`swap halves unmatched: ${misses.length}`);
console.log('\nsample:');
console.log(matches.slice(0, 16).map((m) => `  ${m.key.padEnd(11)} ${m.name.padEnd(22)} <= ${m.sclName}`).join('\n'));
if (misses.length) console.log('\nunmatched:', misses.join(', '));

if (!process.argv.includes('--upload')) {
  console.log('\nReport only. Re-run with --upload (and --env-file=.env) to push.');
  process.exit(0);
}

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const skey = process.env.SUPABASE_SERVICE_KEY;
if (!url || !skey) {
  console.error('\nSet VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY (use --env-file=.env).');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctype = (b) => (b[0] === 0x89 ? 'image/png' : b[0] === 0xff ? 'image/jpeg' : 'application/octet-stream');
const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(url, skey, { auth: { persistSession: false } });

let done = 0;
let failed = 0;
for (const m of matches) {
  try {
    const res = await fetch(m.image, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { error } = await supabase.storage
      .from('figure-images')
      .upload(`${m.key}.jpg`, bytes, { contentType: ctype(bytes), upsert: true, cacheControl: '31536000' });
    if (error) throw error;
    done++;
    await sleep(150);
  } catch (err) {
    failed++;
    console.warn(`  failed ${m.name}: ${err.message}`);
  }
}
console.log(`\nUploaded ${done}, ${failed} failed.`);
