// Supabase client for mobile. Env values come from app.json's
// `expo.extra.SUPABASE_URL` / `SUPABASE_ANON_KEY` (set per channel
// via EAS environment variables, or for local dev via app.config.js).
// AsyncStorage is the session backend — RN doesn't have window.localStorage.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const extra = (Constants?.expoConfig?.extra ?? Constants?.manifestExtra ?? {}) as any;

const URL  = extra.SUPABASE_URL  ?? "";
const ANON = extra.SUPABASE_ANON_KEY ?? "";

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached;
  if (!URL || !ANON) return null;
  cached = createClient(URL, ANON, {
    auth: {
      storage: AsyncStorage as any,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,    // mobile uses deep links, handled by ./auth
      storageKey: "lyfos-auth-session-v1",
      flowType: "pkce"
    }
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(URL && ANON);
}
