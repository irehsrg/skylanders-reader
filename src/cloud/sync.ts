// Cloud sync: maps the collection to/from Supabase tables `owned` and
// `wishlist` (both row-level-secured to the signed-in user).
import { supabase } from './supabase';
import { getUser } from './auth';
import type { Collection, CloudAdapter } from '../collection/collection';
import type { OwnedEntry, WishlistEntry } from '../collection/store';

interface OwnedRow {
  user_id: string;
  key: string;
  char_id: number;
  variant_id: number;
  name: string;
  section: string;
  unknown: boolean;
  copies: unknown;
}
interface WishlistRow {
  user_id: string;
  key: string;
  char_id: number;
  variant_id: number;
  name: string;
  section: string;
}

const rowToOwned = (r: OwnedRow): OwnedEntry => ({
  key: r.key,
  charId: r.char_id,
  variantId: r.variant_id,
  name: r.name,
  section: r.section,
  unknown: r.unknown,
  copies: (r.copies as OwnedEntry['copies']) ?? [],
});
const ownedToRow = (e: OwnedEntry, userId: string): OwnedRow => ({
  user_id: userId,
  key: e.key,
  char_id: e.charId,
  variant_id: e.variantId,
  name: e.name,
  section: e.section,
  unknown: e.unknown,
  copies: e.copies,
});
const rowToWish = (r: WishlistRow): WishlistEntry => ({
  key: r.key,
  charId: r.char_id,
  variantId: r.variant_id,
  name: r.name,
  section: r.section,
});
const wishToRow = (e: WishlistEntry, userId: string): WishlistRow => ({
  user_id: userId,
  key: e.key,
  char_id: e.charId,
  variant_id: e.variantId,
  name: e.name,
  section: e.section,
});

async function userId(): Promise<string> {
  const user = await getUser();
  if (!user) throw new Error('Not signed in.');
  return user.id;
}

/** Per-change write-through adapter (used while signed in). */
export function makeCloudAdapter(): CloudAdapter {
  return {
    async upsertOwned(entry) {
      if (!supabase) return;
      await supabase.from('owned').upsert(ownedToRow(entry, await userId()), { onConflict: 'user_id,key' });
    },
    async upsertWishlist(entry) {
      if (!supabase) return;
      await supabase.from('wishlist').upsert(wishToRow(entry, await userId()), { onConflict: 'user_id,key' });
    },
    async deleteWishlist(key) {
      if (!supabase) return;
      await supabase.from('wishlist').delete().eq('user_id', await userId()).eq('key', key);
    },
  };
}

/**
 * Two-way sync on sign-in: pull cloud rows, merge into local, then push the
 * merged local state back up. Merges are union-based so nothing is lost.
 */
export async function fullSync(collection: Collection): Promise<{ owned: number; wishlist: number }> {
  if (!supabase) return { owned: 0, wishlist: 0 };
  const uid = await userId();

  const [ownedRes, wishRes] = await Promise.all([
    supabase.from('owned').select('*').eq('user_id', uid),
    supabase.from('wishlist').select('*').eq('user_id', uid),
  ]);
  if (ownedRes.error) throw ownedRes.error;
  if (wishRes.error) throw wishRes.error;

  await collection.mergeOwned((ownedRes.data as OwnedRow[]).map(rowToOwned));
  await collection.mergeWishlist((wishRes.data as WishlistRow[]).map(rowToWish));

  const ownedRows = collection.ownedList().map((e) => ownedToRow(e, uid));
  const wishRows = collection.wishlistList().map((w) => wishToRow(w, uid));
  if (ownedRows.length) {
    const { error } = await supabase.from('owned').upsert(ownedRows, { onConflict: 'user_id,key' });
    if (error) throw error;
  }
  if (wishRows.length) {
    const { error } = await supabase.from('wishlist').upsert(wishRows, { onConflict: 'user_id,key' });
    if (error) throw error;
  }
  return { owned: ownedRows.length, wishlist: wishRows.length };
}
