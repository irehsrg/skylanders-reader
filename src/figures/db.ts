// Figure identification: charID + variantID -> figure record.
// Data generated from github.com/Texthead1/Skylander-IDs by
// scripts/build-figure-db.mjs.
import rawFigures from './figures.json';

export interface Figure {
  name: string;
  charId: number;
  variantId: number;
  section: string;
}

const figures = rawFigures as Figure[];

/** The full catalogue, in source order. */
export const allFigures: readonly Figure[] = figures;

const byKey = new Map<number, Figure>();
const byCharId = new Map<number, Figure[]>();
for (const f of figures) {
  byKey.set((f.charId << 16) | f.variantId, f);
  let list = byCharId.get(f.charId);
  if (!list) byCharId.set(f.charId, (list = []));
  list.push(f);
}

export interface LookupResult {
  figure: Figure | null;
  /** Base figure with the same charId, when the exact variant is unknown. */
  baseMatch: Figure | null;
}

export function lookupFigure(charId: number, variantId: number): LookupResult {
  const exact = byKey.get((charId << 16) | variantId) ?? null;
  if (exact) return { figure: exact, baseMatch: null };
  const variants = byCharId.get(charId);
  return { figure: null, baseMatch: variants?.[0] ?? null };
}

/**
 * Parse identity out of block 1 (sector 0). Character ID is a little-endian
 * u16 at offset 0x00; variant ID is a big-endian u16 at offset 0x0C
 * (per the Runes SkylanderFormat doc — e.g. Series 2 = 0x1801 stored as
 * bytes 18 01).
 */
export function parseIdentity(block1: Uint8Array): { charId: number; variantId: number } {
  const charId = block1[0] | (block1[1] << 8);
  const variantId = (block1[0x0c] << 8) | block1[0x0d];
  return { charId, variantId };
}

export const figureCount = figures.length;

/** Number of catalogued figures per section, for completeness denominators. */
export const sectionTotals: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const f of figures) m.set(f.section, (m.get(f.section) ?? 0) + 1);
  return m;
})();

/** Sections in catalogue order (first appearance). */
export const sectionOrder: string[] = (() => {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const f of figures) {
    if (!seen.has(f.section)) { seen.add(f.section); order.push(f.section); }
  }
  return order;
})();
