// Fetch figure images and (optionally) upload them to the Supabase
// `figure-images` bucket keyed by `${charId}-${variantId}.jpg`.
//
// Sources, tried in order per figure:
//   1. darkSpyro per-game index pages — clean transparent character/trap/item art.
//      Each <img> carries the figure name in its title attribute; we match by name,
//      base name (parenthetical stripped), the parenthetical itself (traps/items are
//      titled by their "<Element> <Type>", which is exactly our parenthetical), and
//      with a leading "Legendary " stripped.
//   2. Fandom wiki MediaWiki API (action=query&prop=pageimages) — fills traps, dark
//      variants, vehicles and items darkSpyro lacks. No scraping/auth needed.
//   3. Creation Crystals: per-element fallback to the wiki crystal art.
//
// Anything still unresolved is written to scripts/missing-images.json so the
// remaining tail can be sourced manually.
//
// Usage:
//   node scripts/sync-images.mjs            # dry run: report coverage + write missing-images.json
//   node scripts/sync-images.mjs --upload   # also download + upload to Supabase
//   node scripts/sync-images.mjs --upload --force   # re-upload even if already in the bucket
//
// Upload needs (never commit these):
//   VITE_SUPABASE_URL   (or SUPABASE_URL)
//   SUPABASE_SERVICE_KEY  (service_role key — Project Settings → API)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const figures = JSON.parse(readFileSync(join(root, 'src', 'figures', 'figures.json'), 'utf8'));

const GAMES = ['skylanders', 'giants', 'swapforce', 'trapteam', 'superchargers', 'imaginators'];
const ORIGIN = 'https://www.darkspyro.net';
const PAGES = GAMES.map((g) => `${ORIGIN}/${g}/figures/`);
const WIKI = 'https://skylanders.fandom.com/api.php';
const UA = 'Mozilla/5.0 (PortalTracker image sync; non-commercial fan tool)';

const norm = (s) => s.toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const paren = (s) => {
  const m = s.match(/\(([^)]+)\)/);
  return m ? m[1] : null;
};
const stripParen = (s) => s.replace(/\s*\(.*?\)\s*/g, '').trim();
const stripLegendary = (s) => s.replace(/^Legendary\s+/, '');

// ---- Source 1: darkSpyro scrape -------------------------------------------
async function scrapeDarkSpyro() {
  const map = new Map(); // normalized title -> absolute image url
  for (const page of PAGES) {
    const res = await fetch(page, { headers: { 'User-Agent': UA } });
    const html = await res.text();
    // Broadened from the old `c_*.jpg` filter so trap/item/vehicle art is captured too.
    const re = /<img src="(\/images\/[^"]+\.jpg)"[^>]*?(?:alt|title)="([^"]+)"/g;
    let m;
    let count = 0;
    while ((m = re.exec(html))) {
      const key = norm(m[2]);
      if (key && !map.has(key)) {
        map.set(key, ORIGIN + m[1]);
        count++;
      }
    }
    console.log(`  darkSpyro ${page.split('/').slice(-3, -2)[0].padEnd(14)} ${count} images`);
    await sleep(800);
  }
  return map;
}

function matchDarkSpyro(fig, map) {
  const candidates = [fig.name, stripParen(fig.name), paren(fig.name), stripLegendary(fig.name)];
  for (const c of candidates) {
    if (!c) continue;
    const url = map.get(norm(c));
    if (url) return url;
  }
  return null;
}

// ---- Source 2/3: Fandom wiki ----------------------------------------------
const wikiCache = new Map();
async function wikiImage(title) {
  if (!title) return null;
  if (wikiCache.has(title)) return wikiCache.get(title);
  const url = `${WIKI}?action=query&format=json&prop=pageimages&piprop=original&redirects=1&titles=${encodeURIComponent(title)}`;
  let img = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const json = await res.json();
    const pages = json.query?.pages || {};
    const page = pages[Object.keys(pages)[0]];
    img = page?.original?.source || null;
  } catch {
    img = null;
  }
  wikiCache.set(title, img);
  await sleep(120);
  return img;
}

async function matchWiki(fig) {
  const tries = [...new Set([fig.name, stripParen(fig.name), stripLegendary(fig.name)])];
  for (const t of tries) {
    const img = await wikiImage(t);
    if (img) return img;
  }
  // Creation Crystals: no per-shape art exists; fall back to per-element crystal art.
  if (/Creation Crystal/i.test(fig.name)) {
    const element = fig.name.split(' ')[0]; // "Magic Creation Crystal (Pyramid)" -> "Magic"
    const img =
      (await wikiImage(`${element} Creation Crystal`)) || (await wikiImage('Creation Crystal'));
    if (img) return img;
  }
  return null;
}

// ---------------------------------------------------------------------------
async function resolveAll() {
  console.log('Scraping darkSpyro figure pages…');
  const ds = await scrapeDarkSpyro();
  console.log(`Scraped ${ds.size} unique darkSpyro images.\n`);

  const matched = [];
  const misses = [];
  let viaWiki = 0;
  for (const fig of figures) {
    let url = matchDarkSpyro(fig, ds);
    let source = 'darkSpyro';
    if (!url) {
      url = await matchWiki(fig);
      if (url) {
        source = 'wiki';
        viaWiki++;
      }
    }
    if (url) matched.push({ fig, url, source });
    else misses.push(fig);
  }

  const viaDs = matched.length - viaWiki;
  console.log(`Matched ${matched.length}/${figures.length}  (${viaDs} darkSpyro, ${viaWiki} wiki).`);
  console.log(`Missing: ${misses.length}`);

  const missPath = join(here, 'missing-images.json');
  writeFileSync(
    missPath,
    JSON.stringify(
      misses.map((f) => ({ name: f.name, charId: f.charId, variantId: f.variantId, section: f.section })),
      null,
      2,
    ),
  );
  console.log(`Wrote ${misses.length} unresolved figures to scripts/missing-images.json`);
  return matched;
}

async function upload(matched) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('\nSet VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY to upload.');
    process.exit(1);
  }
  const force = process.argv.includes('--force');
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // List existing keys so we skip what's already uploaded (unless --force).
  const existing = new Set();
  if (!force) {
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.storage
        .from('figure-images')
        .list('', { limit: 1000, offset });
      if (error || !data?.length) break;
      for (const o of data) existing.add(o.name);
      if (data.length < 1000) break;
      offset += data.length;
    }
    console.log(`\n${existing.size} images already in bucket; skipping those.`);
  }

  let done = 0;
  let skipped = 0;
  let failed = 0;
  let recovered = 0;
  for (const { fig, url: imgUrl, source } of matched) {
    const path = `${fig.charId}-${fig.variantId}.jpg`;
    if (!force && existing.has(path)) {
      skipped++;
      continue;
    }
    try {
      let res = await fetch(imgUrl, { headers: { 'User-Agent': UA } });
      // darkSpyro occasionally has dead image links; fall back to the wiki on 404.
      if (!res.ok && source === 'darkSpyro') {
        const alt = await matchWiki(fig);
        if (alt) {
          const altRes = await fetch(alt, { headers: { 'User-Agent': UA } });
          if (altRes.ok) {
            res = altRes;
            recovered++;
          }
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const { error } = await supabase.storage
        .from('figure-images')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      done++;
      if (done % 50 === 0) console.log(`  uploaded ${done}…`);
      await sleep(150);
    } catch (err) {
      failed++;
      console.warn(`  failed ${fig.name}: ${err.message}`);
    }
  }
  console.log(
    `\nUploaded ${done} (${recovered} recovered via wiki after darkSpyro 404), skipped ${skipped} (already present), ${failed} failed.`,
  );
}

async function main() {
  const matched = await resolveAll();
  if (process.argv.includes('--upload')) await upload(matched);
  else console.log('\nDry run. Re-run with --upload (and SUPABASE_SERVICE_KEY set) to push to Supabase.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
