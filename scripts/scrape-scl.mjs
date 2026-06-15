// Scrape skylanderscharacterlist.com into a reusable index of
// { title, image, slug } for every figure-variant page (one per sitemap entry).
// Each page exposes clean <meta og:title> (the variant name) and <meta og:image>
// (the figure photo), which is exactly what we need to match variant art.
//
// Output: scripts/scl-index.json  (cached; re-run with --refresh to rebuild)
//
//   node scripts/scrape-scl.mjs            # build index (skips if it already exists)
//   node scripts/scrape-scl.mjs --refresh  # force re-scrape
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SITEMAP = 'https://skylanderscharacterlist.com/sitemap.xml';
const UA = 'Mozilla/5.0 (PortalTracker variant-art index; non-commercial fan tool)';
const OUT = join(here, 'scl-index.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) =>
  s
    .replace(/&#0?38;|&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&#8217;|&#8216;/g, "'")
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .trim();

// Pages that are category/landing/blog, not a single figure.
const SKIP_SLUG = /^(swap-force-figures|giants-figures|trap-team-figures|superchargers-figures|imaginators-figures|spyros-adventure-figures|skylanders-.*-list|about|contact|privacy|blog|$)/;

async function pageMeta(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const html = await res.text();
  const title = html.match(/<meta property="og:title" content="([^"]*)"/i)?.[1];
  const image = html.match(/<meta property="og:image" content="([^"]*)"/i)?.[1];
  if (!title || !image) return null;
  // og:title = "<Variant Name> - <Game> |"  → strip the trailing " - Game |".
  let name = decode(title).replace(/\s*\|\s*$/, '');
  name = name.replace(/\s*-\s*(Spyro's Adventure|Giants|SWAP Force|Trap Team|SuperChargers|Imaginators)\s*$/i, '');
  return { name, image, slug: new URL(url).pathname.replace(/\//g, '') };
}

async function main() {
  if (existsSync(OUT) && !process.argv.includes('--refresh')) {
    const idx = JSON.parse(readFileSync(OUT, 'utf8'));
    console.log(`${OUT} already exists with ${idx.length} entries. Use --refresh to rebuild.`);
    return;
  }
  console.log('Fetching sitemap…');
  const xml = await (await fetch(SITEMAP, { headers: { 'User-Agent': UA } })).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].replace(/^http:/, 'https:'))
    .filter((u) => !SKIP_SLUG.test(new URL(u).pathname.replace(/\//g, '')));
  console.log(`${urls.length} candidate figure pages.`);

  const index = [];
  let done = 0;
  for (const url of urls) {
    try {
      const meta = await pageMeta(url);
      if (meta) index.push(meta);
    } catch (err) {
      console.warn(`  skip ${url}: ${err.message}`);
    }
    if (++done % 25 === 0) console.log(`  ${done}/${urls.length}…`);
    await sleep(250);
  }
  writeFileSync(OUT, JSON.stringify(index, null, 2));
  console.log(`\nWrote ${index.length} entries to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
