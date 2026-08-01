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
  openSealedShare,
  shareStringToBytes,
  deriveHolderKeypairFromPassphrase
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
    .neq("status", "revoked")
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

  const normalizedEmail = holderEmail.trim().toLowerCase();
  await sb
    .from("key_holders")
    .delete()
    .eq("owner_id", userData.user.id)
    .eq("holder_email", normalizedEmail)
    .eq("status", "revoked");

  const invite_token = makeInviteToken();
  const { data, error } = await sb
    .from("key_holders")
    .insert({
      owner_id: userData.user.id,
      holder_email: normalizedEmail,
      holder_phone: holderPhone?.trim() || null,
      label: label.trim(),
      invite_token,
      status: "pending"
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505" || /key_holders_owner_id_holder_email_key/i.test(error.message || "")) {
      throw new Error("This email is already in your trust circle. Open the existing invite and use Send email again.");
    }
    throw error;
  }
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

export async function deleteKeyHolder(holderId) {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  const { error } = await sb
    .from("key_holders")
    .delete()
    .eq("id", holderId)
    .in("status", ["pending", "revoked"]);
  if (error) throw error;
}

export function summarizeKeyHolders(holders = []) {
  const activeHolders = holders.filter((h) => h?.status !== "revoked");
  const readyHolders = activeHolders.filter((h) =>
    (h.status === "accepted" || h.status === "verified") && Boolean(h.release_pubkey)
  );
  const acceptedHolders = activeHolders.filter((h) => h.status === "accepted" || h.status === "verified");
  const finalizedHolders = activeHolders.filter((h) => h.status === "verified");

  return {
    activeHolders,
    readyHolders,
    acceptedHolders,
    finalizedHolders,
    invited: activeHolders.length,
    accepted: acceptedHolders.length,
    verified: readyHolders.length,
    finalized: finalizedHolders.length
  };
}

export function buildTrustRosterSlots(holders = [], slotCount = 5) {
  const active = holders.filter((h) => h?.status !== "revoked").slice(0, slotCount);
  const holderSlots = active.map((holder, index) => ({
    kind: "holder",
    slotNumber: index + 1,
    holder,
    displayName: holder.label || holder.holder_email?.split("@")[0] || `Trusted person ${index + 1}`,
    email: holder.holder_email || "",
    statusLabel: statusLabelForHolder(holder),
    ready: (holder.status === "accepted" || holder.status === "verified") && Boolean(holder.release_pubkey)
  }));
  const emptySlots = Array.from({ length: Math.max(0, slotCount - holderSlots.length) }, (_, i) => ({
    kind: "empty",
    slotNumber: holderSlots.length + i + 1,
    displayName: "",
    email: "",
    statusLabel: "Not invited",
    ready: false
  }));
  return [...holderSlots, ...emptySlots];
}

export function summarizeHeldKeys(rows = []) {
  const relationships = rows
    .filter((row) => row?.status !== "revoked")
    .map((row) => {
      const ownerEmail = row.owner_email || row.owner?.email || "";
      const ownerLabel = ownerEmail.split("@")[0] || "Vault owner";
      const ready = (row.status === "accepted" || row.status === "verified") && Boolean(row.release_pubkey);
      return {
        id: row.id,
        ownerEmail,
        ownerLabel,
        holderLabel: row.label || "Trusted nominee",
        status: row.status,
        statusLabel: ready ? "Ready" : statusLabelForHolder(row),
        secretVisible: false,
        ready
      };
    });

  return {
    relationships,
    total: relationships.length,
    ready: relationships.filter((r) => r.ready).length
  };
}

export async function listKeysIHeld() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data, error } = await sb.rpc("my_held_keys");
  if (error) throw error;
  return data ?? [];
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
 *   - holders: 5 key_holder rows with status accepted/verified and a release_pubkey
 */
export async function finalizeReleasePlan({ rawVaultKey, holders }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (!Array.isArray(holders) || holders.length !== 5) {
    throw new Error("Need exactly 5 accepted holders to finalize");
  }
  for (const h of holders) {
    if (h.status !== "accepted" && h.status !== "verified") {
      throw new Error(`Holder ${h.label} is in status "${h.status}", expected accepted or verified`);
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

function statusLabelForHolder(holder) {
  if (!holder) return "Not invited";
  if (holder.status === "verified") return "Verified";
  if (holder.status === "accepted") return holder.release_pubkey ? "Accepted" : "Accepted";
  if (holder.status === "pending") return "Invited";
  if (holder.status === "revoked") return "Revoked";
  return "Invited";
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

// ============================================================
// Key holder side — find pending releases, release a share
// ============================================================

/**
 * Find release_requests for which the signed-in user is a verified
 * key holder, joined with the request state and the (encrypted) share
 * she owns. Filters to states where holder action is meaningful.
 */
export async function listReleasesAwaitingMyAction() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) return [];

  // First find my key_holders rows
  const { data: myHolders } = await sb
    .from("key_holders")
    .select("id, owner_id, label, status")
    .eq("holder_user_id", userData.user.id)
    .eq("status", "verified");

  if (!myHolders || myHolders.length === 0) return [];
  const ownerIds = myHolders.map((h) => h.owner_id);

  // Then find active release requests against those owners
  const { data: requests } = await sb
    .from("release_requests")
    .select("*")
    .in("owner_id", ownerIds)
    .in("state", ["approved", "awaiting_shares", "holding"]);

  if (!requests) return [];

  // Find which ones I've already released a share for
  const requestIds = requests.map((r) => r.id);
  const { data: alreadyReleased } = await sb
    .from("release_share_releases")
    .select("release_request_id, key_holder_id")
    .in("release_request_id", requestIds);

  const releasedSet = new Set((alreadyReleased ?? []).map((r) => `${r.release_request_id}:${r.key_holder_id}`));

  // Stitch holder info onto each request
  const contextByRequest = new Map();
  await Promise.all(requests.map(async (req) => {
    const { data, error } = await sb.rpc("holder_release_context", { p_request_id: req.id });
    if (!error) contextByRequest.set(req.id, data ?? []);
  }));

  return requests.map((req) => {
    const holder = myHolders.find((h) => h.owner_id === req.owner_id);
    return {
      ...req,
      myHolderId: holder?.id,
      myLabel: holder?.label,
      iAlreadyReleased: holder ? releasedSet.has(`${req.id}:${holder.id}`) : false,
      holderContext: contextByRequest.get(req.id) ?? []
    };
  });
}

/**
 * Holder unlocks her share, re-encrypts it to the nominee's release
 * process public key, and uploads via holder_release_share RPC.
 *
 * @param {object} params
 * @param {string} params.requestId
 * @param {string} params.holderId             her own key_holders.id
 * @param {string} params.ownerId              the request's owner_id
 * @param {string} params.releaseProcessPubkey from release_requests row
 * @param {string} params.passphrase           her vault passphrase
 * @param {string} params.holderUserId         auth.uid() — for keypair derivation
 */
export async function releaseMyShare({ requestId, holderId, ownerId, releaseProcessPubkey, passphrase, holderUserId }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (!passphrase || passphrase.length < 12) throw new Error("Passphrase required (min 12 chars)");
  const sb = getSupabase();

  // 1. Fetch my encrypted share (RLS only lets me see my own).
  const { data: shareRow, error: shareErr } = await sb
    .from("key_shares")
    .select("share_index, ciphertext, ephemeral_pub")
    .eq("owner_id", ownerId)
    .eq("key_holder_id", holderId)
    .maybeSingle();
  if (shareErr) throw shareErr;
  if (!shareRow) throw new Error("Couldn't find your share for this owner");

  // 2. Re-derive my release keypair from passphrase + my user_id
  const myKp = await deriveHolderKeypairFromPassphrase(passphrase, holderUserId);

  // 3. Decrypt the share with my secret key
  let shareBytes;
  try {
    shareBytes = await openSealedShare(
      { ciphertext: shareRow.ciphertext, ephemeralPub: shareRow.ephemeral_pub },
      myKp.secretKey
    );
  } catch {
    throw new Error("Couldn't decrypt your share. Did you type the same passphrase you used when accepting the invite?");
  }

  // 4. Re-encrypt the share to the nominee's release_process_pubkey
  const sealed = await sealShareToPubkey(shareBytes, releaseProcessPubkey);
  // Zero the decrypted plaintext best-effort
  for (let i = 0; i < shareBytes.length; i++) shareBytes[i] = 0;

  // 5. Upload via RPC (atomic: insert + maybe advance state)
  const { error: rpcErr } = await sb.rpc("holder_release_share", {
    p_request_id: requestId,
    p_share_index: shareRow.share_index,
    p_ciphertext: sealed.ciphertext,
    p_ephemeral_pub: sealed.ephemeralPub
  });
  if (rpcErr) throw rpcErr;

  return { shareIndex: shareRow.share_index };
}
