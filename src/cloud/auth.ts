// Authentication wrapper over Supabase Auth: Google OAuth, email+password,
// and magic link. All no-op (throw) gracefully if the backend isn't set up.
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

function client() {
  if (!supabase) throw new Error('Cloud backend is not configured.');
  return supabase;
}

export async function getUser(): Promise<User | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export function onAuthChange(cb: (user: User | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle(): Promise<void> {
  await client().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
}

export async function signUpWithPassword(email: string, password: string): Promise<string> {
  const { data, error } = await client().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
  return data.session
    ? 'Signed in.'
    : 'Account created — check your email to confirm. (Tip: Google sign-in is instant.)';
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signInWithMagicLink(email: string): Promise<void> {
  const { error } = await client().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await client().auth.signOut();
}
