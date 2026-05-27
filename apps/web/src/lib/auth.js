// Thin auth surface over Supabase. Pure functions; no React.
// Every function tolerates Supabase not being configured yet —
// the existing local-only flow keeps working in that mode.

import { getSupabase, isSupabaseConfigured } from "./supabaseClient.js";

const DEVICE_TOKEN_KEY = "lyfos-device-token-v1";

export function ensureDeviceToken() {
  if (typeof window === "undefined") return null;
  let token = window.localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }
  return token;
}

export function getDeviceToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(DEVICE_TOKEN_KEY);
}

export async function getSession() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session ?? null;
}

export async function getUser() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

export function onAuthStateChange(callback) {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription?.unsubscribe();
}

export async function signUpWithPassword({ email, password }) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: emailRedirect()
    }
  });
  if (error) throw error;
  return data;
}

export async function signInWithPassword({ email, password }) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithMagicLink({ email }) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: emailRedirect(),
      shouldCreateUser: true
    }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

export async function resetPasswordEmail({ email }) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: emailRedirect()
  });
  if (error) throw error;
  return data;
}

export async function appendServerAuditEvent(eventType, meta = {}) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.rpc("append_audit_event", {
      p_event_type: eventType,
      p_event_meta: meta,
      p_device_token: getDeviceToken()
    });
  } catch (err) {
    // Never block the user flow on telemetry. Quietly log.
    if (typeof console !== "undefined") {
      console.warn("[lyfos] audit append failed:", err?.message ?? err);
    }
  }
}

function requireSupabase() {
  const sb = getSupabase();
  if (!sb) {
    throw new Error("Auth is not configured on this deployment. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  return sb;
}

function emailRedirect() {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/`;
}

export { isSupabaseConfigured };
