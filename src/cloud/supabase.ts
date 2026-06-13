// Supabase client. Returns null when env vars aren't configured, so the app
// runs fully offline (IndexedDB only) until a backend is wired up.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const cloudEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/** Public URL for a figure image stored in the `figure-images` bucket. */
export function figureImageUrl(charId: number, variantId: number): string | null {
  if (!supabase) return null;
  const path = `${charId}-${variantId}.webp`;
  return supabase.storage.from('figure-images').getPublicUrl(path).data.publicUrl;
}
