// Community figure-requests, voting, feedback, and admin triage — all over the
// RLS-protected `figure_requests` / `request_votes` tables. Every call no-ops
// gracefully when the backend isn't configured.
import { supabase } from './supabase';
import { getUser } from './auth';

export type RequestKind = 'figure' | 'feedback';
export type RequestStatus = 'pending' | 'planned' | 'added' | 'rejected' | 'duplicate';

export interface FigureRequest {
  id: string;
  user_id: string | null;
  kind: RequestKind;
  name: string;
  section: string;
  notes: string;
  status: RequestStatus;
  admin_notes: string;
  vote_count: number;
  created_at: string;
  updated_at: string;
}

export interface AdminStats {
  users: number;
  collectors: number;
  owned_rows: number;
  figures_tracked: number;
  wishlist_rows: number;
  requests_pending: number;
  requests_total: number;
  feedback_open: number;
}

/** Whether the signed-in account holds admin rights (server-evaluated). */
export async function isAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

/** Submit a figure request or a feedback message (sign-in required). */
export async function submitRequest(input: {
  kind: RequestKind;
  name: string;
  section?: string;
  notes?: string;
}): Promise<void> {
  if (!supabase) throw new Error('Backend not configured.');
  const user = await getUser();
  if (!user) throw new Error('Please sign in first.');
  const name = input.name.trim();
  if (!name) throw new Error(input.kind === 'figure' ? 'Enter a figure name.' : 'Enter a message.');
  const { error } = await supabase.from('figure_requests').insert({
    user_id: user.id,
    kind: input.kind,
    name,
    section: input.section?.trim() ?? '',
    notes: input.notes?.trim() ?? '',
  });
  if (error) throw error;
}

/** Public most-wanted figure requests (open ones), highest-voted first. */
export async function listPublicRequests(): Promise<FigureRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('figure_requests')
    .select('*')
    .eq('kind', 'figure')
    .in('status', ['pending', 'planned'])
    .order('vote_count', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data as FigureRequest[]) ?? [];
}

/** The set of request ids the signed-in user has already upvoted. */
export async function myVotedIds(): Promise<Set<string>> {
  if (!supabase) return new Set();
  const user = await getUser();
  if (!user) return new Set();
  const { data } = await supabase.from('request_votes').select('request_id').eq('user_id', user.id);
  return new Set((data ?? []).map((r: { request_id: string }) => r.request_id));
}

export async function vote(requestId: string): Promise<void> {
  if (!supabase) return;
  const user = await getUser();
  if (!user) throw new Error('Please sign in to vote.');
  const { error } = await supabase
    .from('request_votes')
    .insert({ request_id: requestId, user_id: user.id });
  // Ignore the unique-violation when a stale UI double-votes.
  if (error && error.code !== '23505') throw error;
}

export async function unvote(requestId: string): Promise<void> {
  if (!supabase) return;
  const user = await getUser();
  if (!user) return;
  const { error } = await supabase
    .from('request_votes')
    .delete()
    .eq('request_id', requestId)
    .eq('user_id', user.id);
  if (error) throw error;
}

// ---- admin -----------------------------------------------------------------

/** All requests of a kind, newest first (admin-only via RLS). */
export async function listAllRequests(kind: RequestKind): Promise<FigureRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('figure_requests')
    .select('*')
    .eq('kind', kind)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as FigureRequest[]) ?? [];
}

export async function updateRequest(
  id: string,
  patch: { status?: RequestStatus; admin_notes?: string },
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('figure_requests').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteRequest(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('figure_requests').delete().eq('id', id);
  if (error) throw error;
}

export async function adminStats(): Promise<AdminStats | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('admin_stats');
  if (error) throw error;
  return data as AdminStats;
}
