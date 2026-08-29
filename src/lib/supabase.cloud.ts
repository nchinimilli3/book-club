// Cloudflare production builds resolve @book-club/supabase to this module.
// Keeping the legacy client out of this dependency graph prevents its SDK,
// project URL, and browser requests from reaching the D1/R2 artifact.
export const isSupabaseConfigured = false;
// `any` is compile-time compatibility only. Its runtime value is null, so a
// Cloudflare build cannot create a legacy client or issue a Supabase request.
export const supabase: any = null;
