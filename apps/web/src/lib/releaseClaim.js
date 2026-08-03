// Lyfos release-claim helpers. Three roles touch this module:
//   - OWNER: creates / rotates her own claim_token (releaseSettings*)
//   - NOMINEE: peeks the claim page, files a new release_request,
//              uploads the death certificate to Storage
//   - ADMIN (founder): lists pending claims, signs URLs to certs,
//                      approves/rejects

import { getSupabase, isSupabaseConfigured } from "./supabaseClient.js";
import { isValidNomineeEmail } from "./releaseValidation.js";

export { isValidNomineeEmail } from "./releaseValidation.js";

// ============================================================
// Owner side — release_settings (claim URL the owner shares)
// ============================================================

export async function loadMyReleaseSettings() {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data, error } = await sb.from("release_settings").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertMyReleaseSettings({ claimText, nomineeEmail, nomineeLabel } = {}) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (!isValidNomineeEmail(nomineeEmail)) throw new Error("A valid nominee email is required");
  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) throw new Error("Not signed in");

  const existing = await loadMyReleaseSettings();
  const claim_token = existing?.claim_token ?? makeClaimToken();

  const payload = {
    user_id: userData.user.id,
    claim_token,
    claim_text: claimText ?? existing?.claim_text ?? null,
    nominee_email: nomineeEmail ?? existing?.nominee_email ?? null,
    nominee_label: nomineeLabel ?? existing?.nominee_label ?? null
  };

  const { data, error } = await sb
    .from("release_settings")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function rotateMyClaimToken() {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) throw new Error("Not signed in");

  const claim_token = makeClaimToken();
  const { data, error } = await sb
    .from("release_settings")
    .update({ claim_token })
    .eq("user_id", userData.user.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ============================================================
// Nominee side — peek + file claim + upload death cert
// ============================================================

export async function peekClaim(token) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.rpc("peek_claim", { p_token: token });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0];
}

export async function uploadDeathCertificate(file) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (!file) throw new Error("file required");
  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) throw new Error("Not signed in");

  // Path: <user_id>/<timestamp>-<sanitized-name>
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const path = `${userData.user.id}/${Date.now()}-${safeName}`;
  const { error } = await sb.storage
    .from("death_certificates")
    .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  return path;
}

export async function createReleaseRequest({ claimToken, releaseProcessPubkey, deathCertificatePath }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_release_request", {
    p_claim_token: claimToken,
    p_release_process_pubkey: releaseProcessPubkey,
    p_death_certificate_path: deathCertificatePath ?? null
  });
  if (error) throw error;
  return data;
}

export async function listEntrustedVaults() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data, error } = await sb.rpc("my_entrusted_vaults");
  if (error) throw error;
  return data ?? [];
}

export async function getEntrustedInstructions(holderId) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_entrusted_instructions", { p_holder_id: holderId });
  if (error) throw error;
  return data;
}

export async function createRelationshipRecoveryRequest({
  holderId,
  requestKind,
  fallbackReason,
  evidenceSummary,
  evidencePath
}) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_relationship_recovery_request", {
    p_holder_id: holderId,
    p_request_kind: requestKind,
    p_fallback_reason: fallbackReason?.trim() || null,
    p_evidence_summary: evidenceSummary?.trim() || null,
    p_evidence_path: evidencePath || null
  });
  if (error) throw error;
  return data;
}

export async function getReadyRecoveryMaterial(requestId) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.rpc("get_ready_recovery_material", { p_request_id: requestId });
  if (error) throw error;
  return data;
}

export async function markRecipientRecoveryOpened(requestId) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { error } = await sb.rpc("mark_recipient_recovery_opened", { p_request_id: requestId });
  if (error) throw error;
}

export async function getRecipientRecoveryProgress(requestId) {
  if (!isSupabaseConfigured()) return { approved: 0, refused: 0, waiting: 0, required: 2 };
  const sb = getSupabase();
  const { data, error } = await sb.rpc("recipient_recovery_progress", { p_request_id: requestId });
  if (error) throw error;
  return data ?? { approved: 0, refused: 0, waiting: 0, required: 2 };
}

export async function getRecipientRecoveryProgressDetailed(requestId) {
  if (!isSupabaseConfigured()) return { recipient: null, supporters: [], required: 2 };
  const sb = getSupabase();
  const { data, error } = await sb.rpc("recipient_recovery_progress_detailed", { p_request_id: requestId });
  if (error) throw error;
  return data ?? { recipient: null, supporters: [], required: 2 };
}

export async function reportInvalidRecoverySupport(requestId, keyHolderId) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { error } = await sb.rpc("report_invalid_recovery_support", {
    p_request_id: requestId,
    p_key_holder_id: keyHolderId
  });
  if (error) throw error;
}

export async function fetchMyReleaseRequests() {
  // For a nominee: returns the requests SHE raised.
  // For an owner: returns requests against her vault.
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from("release_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

const INFLIGHT_STATES = [
  "under_review", "collecting_support", "holding", "ready_to_recover",
  // Keep legacy in-flight rows visible while existing installations migrate.
  "pending_review", "approved", "awaiting_shares", "ready_to_release"
];

export async function fetchActiveReleaseAgainstMe() {
  // For an owner: the single in-flight release request against her vault,
  // if any. RLS limits the table view to her own owner_id rows.
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) return null;
  const { data, error } = await sb
    .from("release_requests")
    .select("*")
    .eq("owner_id", userData.user.id)
    .in("state", INFLIGHT_STATES)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchSharesReleasedFor(requestId) {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from("release_share_releases")
    .select("id, key_holder_id, share_index, released_at, ciphertext, ephemeral_pub")
    .eq("release_request_id", requestId)
    .order("released_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function ownerAbortRelease(requestId, reason) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { error } = await sb.rpc("owner_abort_release", {
    p_request_id: requestId,
    p_reason: reason ?? "owner_abort"
  });
  if (error) throw error;
}

// ============================================================
// Admin side
// ============================================================

export async function adminListPendingReleases() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data, error } = await sb.rpc("admin_list_pending_releases");
  if (error) throw error;
  return data ?? [];
}

/**
 * Get a short-lived signed URL to the death certificate uploaded for
 * a release request. Admin-only at the database layer.
 */
export async function adminGetCertificateUrl(requestId) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data: path, error } = await sb.rpc("admin_get_certificate_url", { p_request_id: requestId });
  if (error) throw error;
  if (!path) return null;
  const { data, error: signErr } = await sb.storage
    .from("death_certificates")
    .createSignedUrl(path, 60);
  if (signErr) throw signErr;
  return data?.signedUrl ?? null;
}

export async function adminApproveRelease(requestId, note) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { error } = await sb.rpc("admin_approve_release", {
    p_request_id: requestId,
    p_admin_note: note ?? null
  });
  if (error) throw error;
}

export async function sendRecoveryNotifications(requestId) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke("send-recovery-notifications", {
    body: { request_id: requestId }
  });
  if (error) throw error;
  return data;
}

export async function adminRejectRelease(requestId, reason) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (!reason?.trim()) throw new Error("Rejection reason is required");
  const sb = getSupabase();
  const { error } = await sb.rpc("admin_reject_release", {
    p_request_id: requestId,
    p_reason: reason.trim()
  });
  if (error) throw error;
}

// ============================================================
// helpers
// ============================================================

function makeClaimToken() {
  // 22-char URL-safe random (~128 bits). The same shape as invite_token.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
