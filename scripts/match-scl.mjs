// Match the skylanderscharacterlist index (scl-index.json) to figures.json and
// optionally upload the matched variant art to Supabase.
//
// Matching is order-independent on tokens (so "LightCore Warnado" == "Warnado
// (LightCore)"), with Series-N handling (Series 1 / no-suffix == base).
//
//   node scripts/match-scl.mjs                         # report coverage, write scl-matches.json
//   node --env-file=.env scripts/match-scl.mjs --upload            # upload ALL confident matches
//   node --env-file=.env scripts/match-scl.mjs --upload --only-missing  # only fill figures with no art yet
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const figures = JSON.parse(readFileSync(join(root, 'src', 'figures', 'figures.json'), 'utf8'));
const index = JSON.parse(readFileSync(join(here, 'scl-index.json'), 'utf8'));
const UA = 'Mozilla/5.0 (PortalTracker variant-art match; non-commercial fan tool)';
const STOP = new Set(['the', 'in', 'of', 'and', 'a']);

// name -> "sorted-core-tokens#seriesKey". Series 1 / no suffix both yield "".
function sig(name) {
  let toks = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/);
  let s = '';
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'series' && /^\d$/.test(toks[i + 1] || '')) {
      if (toks[i + 1] !== '1') s = 's' + toks[i + 1];
      toks.splice(i, 2);
      i--;
    }
  }
  toks = toks.filter((t) => t && !STOP.has(t));
  toks.sort();
  return toks.join('-') + '#' + s;
}

// Group both sides by signature.
const figBySig = new Map();
for (const f of figures) {
  const k = sig(f.name);
  (figBySig.get(k) || figBySig.set(k, []).get(k)).push(f);
}
const sclBySig = new Map();
for (const e of index) {
  const k = sig(e.name);
  if (!sclBySig.has(k)) sclBySig.set(k, e); // first wins
}

const matches = [];
const ambiguous = [];
for (const [k, figs] of figBySig) {
  const e = sclBySig.get(k);
  if (!e) continue;
  if (figs.length === 1) {
    const f = figs[0];
    matches.push({ name: f.name, key: `${f.charId}-${f.variantId}`, image: e.image, sclName: e.name });
  } else {
    ambiguous.push({ sig: k, figures: figs.map((f) => f.name), sclName: e.name, image: e.image });
  }
}

writeFileSync(join(here, 'scl-matches.json'), JSON.stringify(matches, null, 2));
const unmatched = figures.filter((f) => !sclBySig.has(sig(f.name)));
console.log(`figures: ${figures.length}  |  scl entries: ${index.length}`);
console.log(`confident 1:1 matches: ${matches.length}`);
console.log(`ambiguous (multiple figures share a name signature): ${ambiguous.length}`);
console.log(`figures with no scl entry: ${unmatched.length}`);
if (ambiguous.length) {
  writeFileSync(join(here, 'scl-ambiguous.json'), JSON.stringify(ambiguous, null, 2));
  console.log('  (written to scl-ambiguous.json)');
}
console.log('\nsample matches:');
console.log(matches.slice(0, 12).map((m) => `  ${m.key.padEnd(10)} ${m.name}  <=  ${m.sclName}`).join('\n'));

if (!process.argv.includes('--upload')) {
  console.log('\nReport only. Re-run with --upload (and --env-file=.env) to push.');
  process.exit(0);
}

// ---- upload --------------------------------------------------------------
let pool = matches;
if (process.argv.includes('--variants-only')) {
  pool = pool.filter((m) => !m.key.endsWith('-0')); // skip base (variantId 0)
  console.log(`\n--variants-only: ${pool.length} of ${matches.length} matches are non-base variants.`);
}
if (process.argv.includes('--only-missing')) {
  const missPath = join(here, 'missing-images.json');
  const miss = existsSync(missPath)
    ? new Set(JSON.parse(readFileSync(missPath, 'utf8')).map((m) => `${m.charId}-${m.variantId}`))
    : new Set();
  pool = matches.filter((m) => miss.has(m.key));
  console.log(`\n--only-missing: ${pool.length} of ${matches.length} matches fill a currently-missing figure.`);
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
for (const m of pool) {
  try {
    const res = await fetch(m.image, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { error } = await supabase.storage
      .from('figure-images')
      .upload(`${m.key}.jpg`, bytes, { contentType: ctype(bytes), upsert: true });
    if (error) throw error;
    done++;
    if (done % 50 === 0) console.log(`  uploaded ${done}/${pool.length}…`);
    await sleep(150);
  } catch (err) {
    failed++;
    console.warn(`  failed ${m.name}: ${err.message}`);
  }
}
console.log(`\nUploaded ${done}, ${failed} failed.`);
