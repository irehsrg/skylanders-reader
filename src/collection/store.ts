// Minimal IndexedDB persistence for the collection. No dependencies.
//
// Two stores:
//   owned    — one record per figure (charId:variantId), with a map of the
//              physical tag UIDs seen (so duplicates are counted by real copy).
//   wishlist — figure keys the user wants but hasn't scanned.

const DB_NAME = 'portal-tracker';
const DB_VERSION = 1;
const OWNED = 'owned';
const WISHLIST = 'wishlist';

export interface TagCopy {
  uid: string;
  firstSeen: number;
  lastSeen: number;
  scans: number;
}

export interface OwnedEntry {
  key: string; // `${charId}:${variantId}`
  charId: number;
  variantId: number;
  name: string;
  section: string;
  unknown: boolean;
  copies: TagCopy[];
}

export interface WishlistEntry {
  key: string;
  charId: number;
  variantId: number;
  name: string;
  section: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OWNED)) db.createObjectStore(OWNED, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(WISHLIST)) db.createObjectStore(WISHLIST, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const ownedGetAll = () => tx<OwnedEntry[]>(OWNED, 'readonly', (s) => s.getAll());
export const ownedPut = (e: OwnedEntry) => tx(OWNED, 'readwrite', (s) => s.put(e));
export const ownedDelete = (key: string) => tx(OWNED, 'readwrite', (s) => s.delete(key));
export const ownedClear = () => tx(OWNED, 'readwrite', (s) => s.clear());

export const wishlistGetAll = () => tx<WishlistEntry[]>(WISHLIST, 'readonly', (s) => s.getAll());
export const wishlistPut = (e: WishlistEntry) => tx(WISHLIST, 'readwrite', (s) => s.put(e));
export const wishlistDelete = (key: string) => tx(WISHLIST, 'readwrite', (s) => s.delete(key));
export const wishlistClear = () => tx(WISHLIST, 'readwrite', (s) => s.clear());
