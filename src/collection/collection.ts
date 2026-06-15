// Collection logic: records scans, tracks duplicates by tag UID, computes
// completeness, and handles JSON backup. Holds an in-memory cache backed by
// IndexedDB.
import { sectionTotals, sectionOrder } from '../figures/db';
import {
  ownedGetAll,
  ownedPut,
  ownedDelete,
  ownedClear,
  wishlistGetAll,
  wishlistPut,
  wishlistDelete,
  type OwnedEntry,
  type WishlistEntry,
  type TagCopy,
} from './store';

export interface ScanInput {
  charId: number;
  variantId: number;
  name: string;
  section: string;
  unknown: boolean;
  uid: string | null;
}

export interface ScanResult {
  entry: OwnedEntry;
  isNewFigure: boolean;
  isNewCopy: boolean;
}

export interface SectionStat {
  section: string;
  owned: number;
  total: number;
  pct: number;
}

export interface Stats {
  ownedFigures: number;
  totalCopies: number;
  catalogTotal: number;
  overallPct: number;
  bySection: SectionStat[];
}

const keyOf = (charId: number, variantId: number) => `${charId}:${variantId}`;

/** Write-through target for cloud sync. Set when the user is signed in. */
export interface CloudAdapter {
  upsertOwned(entry: OwnedEntry): Promise<void>;
  deleteOwned(key: string): Promise<void>;
  upsertWishlist(entry: WishlistEntry): Promise<void>;
  deleteWishlist(key: string): Promise<void>;
}

/** Union two copy lists by UID, keeping earliest firstSeen / latest lastSeen. */
function mergeCopies(a: TagCopy[], b: TagCopy[]): TagCopy[] {
  const byUid = new Map(a.map((c) => [c.uid, { ...c }]));
  for (const c of b) {
    const prev = byUid.get(c.uid);
    if (prev) {
      prev.firstSeen = Math.min(prev.firstSeen, c.firstSeen);
      prev.lastSeen = Math.max(prev.lastSeen, c.lastSeen);
      prev.scans += c.scans;
    } else {
      byUid.set(c.uid, { ...c });
    }
  }
  return [...byUid.values()];
}

export class Collection {
  private owned = new Map<string, OwnedEntry>();
  private wishlist = new Map<string, WishlistEntry>();
  private cloud: CloudAdapter | null = null;

  /** Attach (or detach with null) a cloud write-through target. */
  setCloud(adapter: CloudAdapter | null): void {
    this.cloud = adapter;
  }

  async load(): Promise<void> {
    for (const e of await ownedGetAll()) this.owned.set(e.key, e);
    for (const w of await wishlistGetAll()) this.wishlist.set(w.key, w);
  }

  /** Record a live scan. Returns whether it's a new figure / new physical copy. */
  async recordScan(scan: ScanInput, now = Date.now()): Promise<ScanResult> {
    const key = keyOf(scan.charId, scan.variantId);
    let entry = this.owned.get(key);
    const isNewFigure = !entry;
    if (!entry) {
      entry = {
        key,
        charId: scan.charId,
        variantId: scan.variantId,
        name: scan.name,
        section: scan.section,
        unknown: scan.unknown,
        copies: [],
      };
      this.owned.set(key, entry);
    }

    // Identify the physical copy. When no UID is available (browser
    // detect-only), fold into a single synthetic copy so the figure still
    // counts as owned without inflating duplicates.
    const uid = scan.uid ?? 'no-uid';
    let copy = entry.copies.find((c) => c.uid === uid);
    const isNewCopy = !copy;
    if (!copy) {
      copy = { uid, firstSeen: now, lastSeen: now, scans: 0 };
      entry.copies.push(copy);
    }
    copy.lastSeen = now;
    copy.scans++;

    // Scanning something resolves any wishlist entry for it.
    if (this.wishlist.delete(key)) {
      await wishlistDelete(key);
      this.cloud?.deleteWishlist(key).catch(() => {});
    }

    await ownedPut(entry);
    this.cloud?.upsertOwned(entry).catch(() => {});
    return { entry, isNewFigure, isNewCopy };
  }

  ownedList(): OwnedEntry[] {
    return [...this.owned.values()];
  }

  wishlistList(): WishlistEntry[] {
    return [...this.wishlist.values()];
  }

  isOwned(charId: number, variantId: number): boolean {
    return this.owned.has(keyOf(charId, variantId));
  }

  isWishlisted(charId: number, variantId: number): boolean {
    return this.wishlist.has(keyOf(charId, variantId));
  }

  async addWishlist(e: WishlistEntry): Promise<void> {
    this.wishlist.set(e.key, e);
    await wishlistPut(e);
    this.cloud?.upsertWishlist(e).catch(() => {});
  }

  async removeWishlist(charId: number, variantId: number): Promise<void> {
    const key = keyOf(charId, variantId);
    if (this.wishlist.delete(key)) {
      await wishlistDelete(key);
      this.cloud?.deleteWishlist(key).catch(() => {});
    }
  }

  /** Toggle wishlist for a catalogue figure. Returns the new state. */
  async toggleWishlist(fig: { charId: number; variantId: number; name: string; section: string }): Promise<boolean> {
    const key = keyOf(fig.charId, fig.variantId);
    if (this.wishlist.has(key)) {
      await this.removeWishlist(fig.charId, fig.variantId);
      return false;
    }
    await this.addWishlist({ key, charId: fig.charId, variantId: fig.variantId, name: fig.name, section: fig.section });
    return true;
  }

  copiesOf(charId: number, variantId: number): number {
    return this.owned.get(keyOf(charId, variantId))?.copies.length ?? 0;
  }

  /** Remove an owned figure entirely (local + cloud). */
  async removeOwned(charId: number, variantId: number): Promise<void> {
    const key = keyOf(charId, variantId);
    if (this.owned.delete(key)) {
      await ownedDelete(key);
      this.cloud?.deleteOwned(key).catch(() => {});
    }
  }

  stats(): Stats {
    const ownedBySection = new Map<string, number>();
    let totalCopies = 0;
    for (const e of this.owned.values()) {
      ownedBySection.set(e.section, (ownedBySection.get(e.section) ?? 0) + 1);
      totalCopies += e.copies.length;
    }

    const bySection: SectionStat[] = [];
    let catalogTotal = 0;
    for (const section of sectionOrder) {
      const total = sectionTotals.get(section) ?? 0;
      const owned = Math.min(ownedBySection.get(section) ?? 0, total);
      catalogTotal += total;
      bySection.push({ section, owned, total, pct: total ? Math.round((owned / total) * 100) : 0 });
    }

    const ownedFigures = this.owned.size;
    return {
      ownedFigures,
      totalCopies,
      catalogTotal,
      overallPct: catalogTotal ? Math.round((Math.min(ownedFigures, catalogTotal) / catalogTotal) * 100) : 0,
      bySection,
    };
  }

  // ---- merge (cloud sync + import) -------------------------------------

  /** Merge owned entries (from cloud or a backup) into local, persisting. */
  async mergeOwned(entries: OwnedEntry[]): Promise<void> {
    for (const e of entries) {
      const existing = this.owned.get(e.key);
      if (existing) {
        existing.copies = mergeCopies(existing.copies, e.copies ?? []);
        existing.name = e.name || existing.name;
        existing.section = e.section || existing.section;
        await ownedPut(existing);
      } else {
        this.owned.set(e.key, { ...e, copies: e.copies ?? [] });
        await ownedPut(this.owned.get(e.key)!);
      }
    }
  }

  /** Merge wishlist entries into local, skipping any now owned. */
  async mergeWishlist(entries: WishlistEntry[]): Promise<void> {
    for (const w of entries) {
      if (this.owned.has(w.key) || this.wishlist.has(w.key)) continue;
      this.wishlist.set(w.key, w);
      await wishlistPut(w);
    }
  }

  // ---- backup ----------------------------------------------------------

  exportJSON(): string {
    return JSON.stringify(
      {
        format: 'portal-tracker-collection',
        version: 1,
        exported: new Date().toISOString(),
        owned: this.ownedList(),
        wishlist: this.wishlistList(),
      },
      null,
      2,
    );
  }

  async importJSON(text: string, mode: 'merge' | 'replace' = 'merge'): Promise<number> {
    const data = JSON.parse(text);
    if (data.format !== 'portal-tracker-collection') {
      throw new Error('Not a Portal Tracker backup file.');
    }
    if (mode === 'replace') {
      this.owned.clear();
      await ownedClear();
    }
    const owned = (data.owned ?? []) as OwnedEntry[];
    await this.mergeOwned(owned);
    await this.mergeWishlist((data.wishlist ?? []) as WishlistEntry[]);
    return owned.length;
  }
}
