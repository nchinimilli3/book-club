import { createClient } from '@supabase/supabase-js';

// Never silently point a local build at production. Each environment must opt
// into its own Supabase project through its local environment file.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anon);
export const supabase = url && anon ? createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;
