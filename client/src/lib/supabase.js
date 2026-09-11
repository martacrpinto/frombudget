import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// The legacy API remains available while pages are migrated. Supabase features
// are enabled only when both public Vite variables are configured.
export const isSupabaseConfigured = Boolean(url && anonKey);
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export async function signInWithPassword(email, password) {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase.auth.signInWithPassword({ email, password });
}

export function isPasswordActionUrl() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash;
  return ['recovery', 'invite'].includes(params.get('type')) || /(?:^|[&#])type=(?:recovery|invite)(?:&|$)/.test(hash);
}

export async function updatePassword(password) {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase.auth.updateUser({ password });
}

/** Call the protected admin-users Edge Function. The function enforces the
 * administrator check server-side; no service-role key is ever shipped here. */
export async function adminUsers(action, payload = {}) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action, ...payload } });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function uploadAvatar(profileId, file) {
  if (!supabase) throw new Error('Supabase is not configured');
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${profileId}/avatar.${extension}`;
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (uploadError) throw uploadError;
  const { error: profileError } = await supabase.from('profiles').update({ profile_picture: path }).eq('id', profileId);
  if (profileError) throw profileError;
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, 3600);
  if (error) throw error;
  return { path, url: data.signedUrl };
}

export async function removeAvatar(profileId, previousPath) {
  if (!supabase) throw new Error('Supabase is not configured');
  if (previousPath) await supabase.storage.from('avatars').remove([previousPath]);
  const { error } = await supabase.from('profiles').update({ profile_picture: null }).eq('id', profileId);
  if (error) throw error;
}
