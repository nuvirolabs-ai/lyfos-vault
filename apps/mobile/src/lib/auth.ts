import { getSupabase, isSupabaseConfigured } from "./supabase";
import { ensureDeviceToken, getDeviceToken } from "./storage";

export async function getSession() {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data?.session ?? null;
}

export function onAuthStateChange(cb: (session: any) => void) {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data?.subscription?.unsubscribe();
}

export async function signUpWithPassword({ email, password }: { email: string; password: string }) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: "lyfos://auth-callback" }
  });
  if (error) throw error;
  return data;
}

export async function signInWithPassword({ email, password }: { email: string; password: string }) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithMagicLink({ email }: { email: string }) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: "lyfos://auth-callback", shouldCreateUser: true }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

export async function deleteAccount() {
  const sb = requireSupabase();
  const { error } = await sb.rpc("delete_account");
  if (error) throw error;
  await sb.auth.signOut().catch(() => {});
}

export async function appendServerAuditEvent(eventType: string, meta: any = {}) {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.rpc("append_audit_event", {
      p_event_type: eventType,
      p_event_meta: meta,
      p_device_token: await getDeviceToken()
    });
  } catch {}
}

function requireSupabase() {
  const sb = getSupabase();
  if (!sb) throw new Error("Cloud sync isn't configured in this build. Build with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in app.config.js.");
  return sb;
}

export { ensureDeviceToken, getDeviceToken, isSupabaseConfigured };
