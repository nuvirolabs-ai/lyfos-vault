// Supabase client. Both env vars are evaluated by Vite at build time and
// are safe to ship in the bundle — the anon key is designed to be public.
// All security comes from Row Level Security policies on the database.
//
// If the URL is not set we export a null client and isSupabaseConfigured()
// returns false, so the existing local-only flow keeps working until the
// owner sets the env vars at deploy time.

import { createClient } from "@supabase/supabase-js";

const VITE_ENV = import.meta.env ?? {};
const SUPABASE_URL = VITE_ENV.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = VITE_ENV.VITE_SUPABASE_ANON_KEY;

let cached = null;

export function getSupabase() {
  if (cached) return cached;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  cached = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Use localStorage so existing localStorage cleanup paths see the
      // session and can clear it together with the vault.
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      storageKey: "lyfos-auth-session-v1",
      flowType: "pkce"
    }
  });
  return cached;
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function supabaseUrlForDisplay() {
  if (!SUPABASE_URL) return null;
  try {
    return new URL(SUPABASE_URL).host;
  } catch {
    return SUPABASE_URL;
  }
}
