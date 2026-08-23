import { createClient } from '@supabase/supabase-js';

// These are public client credentials. Supabase security is enforced by RLS.
// Environment variables still override them in staging/production.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  || 'https://srcggpqxhigqfxgvoskx.supabase.co';
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
  || 'sb_publishable_p7bu6Z_PmgUoAfdbU3YPKA_D5BTOEoA';

export const isSupabaseConfigured = Boolean(url && anon);
export const supabase = isSupabaseConfigured ? createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;
