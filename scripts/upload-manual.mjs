// Manually push corrected/variant figure images to the Supabase `figure-images`
// bucket. Use this for figures the automated sync (sync-images.mjs) can't resolve
// or resolves to the wrong art (deco variants, etc.).
//
// Edit scripts/manual-images.json — an array of entries:
//   { "name": "Whirlwind (Stone)", "url": "https://…/StoneWhirlwind.png" }
//   { "key":  "0-6162",            "url": "https://…/StoneWhirlwind.png" }
//   { "name": "Some Figure",       "file": "scripts/manual-images/foo.png" }
// `name` is matched exactly against figures.json; `key` is `${charId}-${variantId}`.
// `url` is downloaded; `file` is read from disk. PNG transparency is preserved.
//
// Usage:
//   node --env-file=.env scripts/upload-manual.mjs            # upload
//   node --env-file=.env scripts/upload-manual.mjs --dry-run  # resolve only, no upload
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const figures = JSON.parse(readFileSync(join(root, 'src', 'figures', 'figures.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(here, 'manual-images.json'), 'utf8'));
const UA = 'Mozilla/5.0 (PortalTracker manual image upload; non-commercial fan tool)';

const byName = new Map(figures.map((f) => [f.name, f]));

function keyFor(entry) {
  if (entry.key) return entry.key;
  const fig = byName.get(entry.name);
  if (!fig) throw new Error(`no figure named "${entry.name}" in figures.json`);
  return `${fig.charId}-${fig.variantId}`;
}

function contentType(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  return 'application/octet-stream';
}

async function bytesFor(entry) {
  if (entry.file) return new Uint8Array(readFileSync(resolve(root, entry.file)));
  const res = await fetch(entry.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${entry.url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const resolved = [];
  for (const entry of manifest) {
    const key = keyFor(entry);
    const label = entry.name || entry.key;
    console.log(`${key.padEnd(10)} <- ${entry.url || entry.file}  (${label})`);
    resolved.push({ ...entry, key, label });
  }
  if (dry) {
    console.log(`\nDry run: ${resolved.length} entries resolved, nothing uploaded.`);
    return;
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const skey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !skey) {
    console.error('\nSet VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY (use --env-file=.env).');
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, skey, { auth: { persistSession: false } });

  let done = 0;
  let failed = 0;
  for (const entry of resolved) {
    try {
      const bytes = await bytesFor(entry);
      const { error } = await supabase.storage
        .from('figure-images')
        .upload(`${entry.key}.jpg`, bytes, { contentType: contentType(bytes), upsert: true });
      if (error) throw error;
      done++;
      console.log(`  ✓ ${entry.key}  ${entry.label}`);
    } catch (err) {
      failed++;
      console.warn(`  ✗ ${entry.label}: ${err.message}`);
    }
  }
  console.log(`\nUploaded ${done}, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
