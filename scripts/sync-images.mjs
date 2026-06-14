// Fetch figure images from darkSpyro and (optionally) upload them to the
// Supabase `figure-images` bucket keyed by `${charId}-${variantId}.jpg`.
//
// Source: darkSpyro per-game figure index pages. Each figure <img> carries the
// exact figure name in its title attribute, so we match by name.
//
// Usage:
//   node scripts/sync-images.mjs           # dry run: report coverage only
//   node scripts/sync-images.mjs --upload  # download + upload to Supabase
//
// Upload needs (never commit these):
//   VITE_SUPABASE_URL   (or SUPABASE_URL)
//   SUPABASE_SERVICE_KEY  (service_role key — Project Settings → API)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const figures = JSON.parse(readFileSync(join(root, 'src', 'figures', 'figures.json'), 'utf8'));

const PAGES = [
  'https://www.darkspyro.net/skylanders/figures/',
  'https://www.darkspyro.net/giants/figures/',
  'https://www.darkspyro.net/swapforce/figures/',
  'https://www.darkspyro.net/trapteam/figures/',
  'https://www.darkspyro.net/superchargers/figures/',
  'https://www.darkspyro.net/imaginators/figures/',
];
const ORIGIN = 'https://www.darkspyro.net';
const UA = 'Mozilla/5.0 (PortalTracker image sync; non-commercial fan tool)';

const norm = (s) => s.toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrape() {
  const map = new Map(); // normalized name -> absolute image url
  for (const page of PAGES) {
    const res = await fetch(page, { headers: { 'User-Agent': UA } });
    const html = await res.text();
    const re = /<img src="(\/images\/[^"]+\/c_[^"]+\.jpg)"[^>]*?(?:alt|title)="([^"]+)"/g;
    let m;
    let count = 0;
    while ((m = re.exec(html))) {
      const url = ORIGIN + m[1];
      const name = m[2];
      const key = norm(name);
      if (!map.has(key)) {
        map.set(key, url);
        count++;
      }
    }
    console.log(`  ${page.split('/').slice(-3, -2)[0].padEnd(14)} ${count} images`);
    await sleep(800);
  }
  return map;
}

/** Try exact name, then base name (strip parenthetical), against the scrape. */
function matchFigure(fig, map) {
  const exact = map.get(norm(fig.name));
  if (exact) return { url: exact, how: 'exact' };
  const base = fig.name.replace(/\s*\(.*?\)\s*/g, '').trim();
  if (base !== fig.name) {
    const baseUrl = map.get(norm(base));
    if (baseUrl) return { url: baseUrl, how: 'base' };
  }
  return null;
}

async function main() {
  const upload = process.argv.includes('--upload');
  console.log('Scraping darkSpyro figure pages…');
  const map = await scrape();
  console.log(`Scraped ${map.size} unique figure images.\n`);

  const matched = [];
  const misses = [];
  for (const fig of figures) {
    const hit = matchFigure(fig, map);
    if (hit) matched.push({ fig, ...hit });
    else misses.push(fig);
  }
  const exact = matched.filter((m) => m.how === 'exact').length;
  console.log(`Matched ${matched.length}/${figures.length} (${exact} exact, ${matched.length - exact} via base figure).`);
  console.log(`Missing: ${misses.length}`);
  console.log('Sample misses:', misses.slice(0, 25).map((f) => f.name).join(', '));

  if (!upload) {
    console.log('\nDry run. Re-run with --upload (and SUPABASE_SERVICE_KEY set) to push to Supabase.');
    return;
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('\nSet VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY to upload.');
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let done = 0;
  let failed = 0;
  for (const { fig, url: imgUrl } of matched) {
    try {
      const res = await fetch(imgUrl, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const path = `${fig.charId}-${fig.variantId}.jpg`;
      const { error } = await supabase.storage
        .from('figure-images')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      done++;
      if (done % 50 === 0) console.log(`  uploaded ${done}/${matched.length}…`);
      await sleep(150);
    } catch (err) {
      failed++;
      console.warn(`  failed ${fig.name}: ${err.message}`);
    }
  }
  console.log(`\nUploaded ${done} images, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
