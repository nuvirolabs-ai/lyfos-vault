// Lyfos release plan — Supabase-backed operations on key_holders /
// key_shares / release_requests.
//
// Every function here tolerates Supabase not being configured.
// Local-only Phase 0 deploys keep working untouched — the Release
// page just shows the "Draft" framing in that case.

import { getSupabase, isSupabaseConfigured } from "./supabaseClient.js";
import {
  splitVaultKey,
  sealShareToPubkey,
  shareStringToBytes
} from "./shareCrypto.js";

// ============================================================
// Owner side
// ============================================================

export async function listMyKeyHolders() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) return [];
  const { data, error } = await sb
    .from("key_holders")
    .select("*")
    .eq("owner_id", userData.user.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createKeyHolderInvite({ label, holderEmail, holderPhone }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (!label?.trim()) throw new Error("Label is required");
  if (!isEmail(holderEmail)) throw new Error("A valid email is required");

  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) throw new Error("Not signed in");

  const invite_token = makeInviteToken();
  const { data, error } = await sb
    .from("key_holders")
    .insert({
      owner_id: userData.user.id,
      holder_email: holderEmail.trim().toLowerCase(),
      holder_phone: holderPhone?.trim() || null,
      label: label.trim(),
      invite_token,
      status: "pending"
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function revokeKeyHolder(holderId) {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  const { error } = await sb
    .from("key_holders")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", holderId);
  if (error) throw error;
}

/**
 * Send the invite email via the send-key-holder-invite Edge Function.
 * If the function isn't deployed yet (404), we surface the invite URL
 * so the owner can share it manually during the beta.
 */
export async function sendInviteEmail(inviteId) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke("send-key-holder-invite", {
    body: { invite_id: inviteId }
  });
  if (error) throw error;
  return data;
}

/**
 * Finalize the release plan: split the unlocked vault key into 5 SSS
 * shares, seal each to the corresponding holder's release_pubkey,
 * upload all 5 key_shares rows, then mark each holder verified.
 *
 * Inputs:
 *   - rawVaultKey: 32-byte Uint8Array (caller exported it from CryptoKey)
 *   - holders: 5 key_holder rows with status === 'accepted' and a release_pubkey
 */
export async function finalizeReleasePlan({ rawVaultKey, holders }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (!Array.isArray(holders) || holders.length !== 5) {
    throw new Error("Need exactly 5 accepted holders to finalize");
  }
  for (const h of holders) {
    if (h.status !== "accepted") {
      throw new Error(`Holder ${h.label} is in status "${h.status}", expected "accepted"`);
    }
    if (!h.release_pubkey) {
      throw new Error(`Holder ${h.label} has not uploaded a release public key yet`);
    }
  }

  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) throw new Error("Not signed in");

  const shareStrings = await splitVaultKey(rawVaultKey);   // 5 SSS shares (hex strings)
  const ownerId = userData.user.id;

  const rows = [];
  for (let i = 0; i < 5; i++) {
    const holder = holders[i];
    const shareBytes = shareStringToBytes(shareStrings[i]);
    const sealed = await sealShareToPubkey(shareBytes, holder.release_pubkey);
    rows.push({
      owner_id: ownerId,
      key_holder_id: holder.id,
      share_index: i + 1,
      ciphertext: sealed.ciphertext,
      ephemeral_pub: sealed.ephemeralPub
    });
  }

  // Replace any existing shares for this owner (e.g. re-finalizing
  // after a holder rotation). RLS lets the owner delete her own shares.
  const { error: delErr } = await sb.from("key_shares").delete().eq("owner_id", ownerId);
  if (delErr) throw delErr;

  const { error: insErr } = await sb.from("key_shares").insert(rows);
  if (insErr) throw insErr;

  // Mark each holder verified via the RPC (which checks a key_shares row exists)
  for (const h of holders) {
    const { error: vErr } = await sb.rpc("mark_holder_verified", { p_holder_id: h.id });
    if (vErr) throw vErr;
  }

  return { sharesUploaded: rows.length };
}

// ============================================================
// Holder side (invite acceptance)
// ============================================================

export async function peekInvite(token) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.rpc("peek_invite", { p_token: token });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0];
}

export async function acceptInvite({ token, releasePubkey }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (!releasePubkey) throw new Error("releasePubkey required");
  const sb = getSupabase();
  const { data, error } = await sb.rpc("accept_invite", {
    p_token: token,
    p_release_pubkey: releasePubkey
  });
  if (error) throw error;
  return data;
}

// ============================================================
// helpers
// ============================================================

function isEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function makeInviteToken() {
  // ~22 base64url chars = 128 bits of entropy. Plenty for unguessable
  // single-use tokens; the lookup row is unique-indexed so collisions
  // are caught.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
