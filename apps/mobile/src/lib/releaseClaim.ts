import { getSupabase, isSupabaseConfigured } from "./supabase";

// ============================================================
// Owner side (claim settings)
// ============================================================
export async function loadMyReleaseSettings() {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase()!;
  const { data, error } = await sb.from("release_settings").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertMyReleaseSettings(input: { claimText?: string; nomineeEmail?: string; nomineeLabel?: string }) {
  const sb = getSupabase()!;
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in");
  const existing = await loadMyReleaseSettings();
  const claim_token = existing?.claim_token ?? makeClaimToken();
  const payload = {
    user_id: u.user.id,
    claim_token,
    claim_text:    input.claimText    ?? existing?.claim_text    ?? null,
    nominee_email: input.nomineeEmail ?? existing?.nominee_email ?? null,
    nominee_label: input.nomineeLabel ?? existing?.nominee_label ?? null
  };
  const { data, error } = await sb.from("release_settings").upsert(payload, { onConflict: "user_id" }).select().single();
  if (error) throw error;
  return data;
}

export async function rotateMyClaimToken() {
  const sb = getSupabase()!;
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in");
  const { data, error } = await sb
    .from("release_settings")
    .update({ claim_token: makeClaimToken() })
    .eq("user_id", u.user.id)
    .select().single();
  if (error) throw error;
  return data;
}

// ============================================================
// Nominee side
// ============================================================
export async function peekClaim(token: string) {
  const sb = getSupabase()!;
  const { data, error } = await sb.rpc("peek_claim", { p_token: token });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0];
}

export async function uploadDeathCertificate(file: { uri: string; name: string; type: string; size?: number }) {
  const sb = getSupabase()!;
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in");
  const safeName = (file.name ?? "cert").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const path = `${u.user.id}/${Date.now()}-${safeName}`;
  // RN: read the file uri as blob via fetch — Expo / Hermes supports this.
  const res = await fetch(file.uri);
  const blob = await res.blob();
  const { error } = await sb.storage
    .from("death_certificates")
    .upload(path, blob, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  return path;
}

export async function createReleaseRequest(input: { claimToken: string; releaseProcessPubkey: string; deathCertificatePath?: string }) {
  const sb = getSupabase()!;
  const { data, error } = await sb.rpc("create_release_request", {
    p_claim_token: input.claimToken,
    p_release_process_pubkey: input.releaseProcessPubkey,
    p_death_certificate_path: input.deathCertificatePath ?? null
  });
  if (error) throw error;
  return data;
}

export async function fetchMyReleaseRequests() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase()!;
  const { data, error } = await sb.from("release_requests").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

const INFLIGHT = ["pending_review", "approved", "awaiting_shares", "holding", "ready_to_release"];

export async function fetchActiveReleaseAgainstMe() {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase()!;
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) return null;
  const { data, error } = await sb
    .from("release_requests").select("*")
    .eq("owner_id", u.user.id)
    .in("state", INFLIGHT)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchSharesReleasedFor(requestId: string) {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase()!;
  const { data, error } = await sb
    .from("release_share_releases")
    .select("id, key_holder_id, share_index, released_at, ciphertext, ephemeral_pub")
    .eq("release_request_id", requestId)
    .order("released_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function ownerAbortRelease(requestId: string, reason?: string) {
  const sb = getSupabase()!;
  const { error } = await sb.rpc("owner_abort_release", { p_request_id: requestId, p_reason: reason ?? "owner_abort" });
  if (error) throw error;
}

// ============================================================
// Admin side (founder review queue)
// ============================================================
export async function adminListPendingReleases() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase()!;
  const { data, error } = await sb.rpc("admin_list_pending_releases");
  if (error) throw error;
  return data ?? [];
}

export async function adminGetCertificateUrl(requestId: string) {
  const sb = getSupabase()!;
  const { data: path, error } = await sb.rpc("admin_get_certificate_url", { p_request_id: requestId });
  if (error) throw error;
  if (!path) return null;
  const { data, error: signErr } = await sb.storage.from("death_certificates").createSignedUrl(path, 60);
  if (signErr) throw signErr;
  return data?.signedUrl ?? null;
}

export async function adminApproveRelease(requestId: string, note?: string) {
  const sb = getSupabase()!;
  const { error } = await sb.rpc("admin_approve_release", { p_request_id: requestId, p_admin_note: note ?? null });
  if (error) throw error;
}

export async function adminRejectRelease(requestId: string, reason: string) {
  if (!reason?.trim()) throw new Error("Rejection reason is required");
  const sb = getSupabase()!;
  const { error } = await sb.rpc("admin_reject_release", { p_request_id: requestId, p_reason: reason.trim() });
  if (error) throw error;
}

function makeClaimToken(): string {
  const bytes = new Uint8Array(16);
  const g = (globalThis as any).crypto;
  if (g?.getRandomValues) g.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  // @ts-ignore
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
