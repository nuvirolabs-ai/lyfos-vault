// Lyfos release plan — Supabase-backed operations on key_holders /
// key_shares / release_requests.
//
// Every function here tolerates Supabase not being configured.
// Local-only Phase 0 deploys keep working untouched — the Release
// page just shows the "Draft" framing in that case.

import { getSupabase, isSupabaseConfigured } from "./supabaseClient.js";
import {
  createRecipientGatedPlan,
  sealShareToPubkey,
  openSealedShare,
  shareStringToBytes,
  deriveHolderKeypairFromPassphrase
} from "./shareCrypto.js";
import { CIRCLE_ROLES, mergeLatestInviteDeliveries, validateCircleForActivation } from "./recoveryCeremony.js";

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
  const holders = data ?? [];
  if (holders.length === 0) return holders;
  const { data: deliveries, error: deliveryError } = await sb
    .from("email_deliveries")
    .select("related_holder_id, state, failure_reason, attempt, updated_at")
    .in("related_holder_id", holders.map((holder) => holder.id))
    .eq("purpose", "holder_invite")
    .order("updated_at", { ascending: false });
  if (deliveryError) throw deliveryError;
  return mergeLatestInviteDeliveries(holders, deliveries ?? []);
}

export async function createKeyHolderInvite({ label, holderEmail, holderPhone, role = CIRCLE_ROLES.TRUSTED }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (!label?.trim()) throw new Error("Label is required");
  if (!isEmail(holderEmail)) throw new Error("A valid email is required");
  if (!Object.values(CIRCLE_ROLES).includes(role)) throw new Error("Choose a valid nominee role");

  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_key_holder_invite", {
    p_holder_email: holderEmail.trim().toLowerCase(),
    p_holder_phone: holderPhone?.trim() || null,
    p_label: label.trim(),
    p_role: role
  });
  if (error) {
    if (error.code === "23505" || /key_holders_owner_id_holder_email_key/i.test(error.message || "")) {
      throw new Error("This email is already in your trust circle. Open the existing invite and use Send email again.");
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invite_id || !row?.invite_token || !row?.delivery_id) throw new Error("Invite service returned an incomplete response");
  return {
    id: row.invite_id,
    invite_token: row.invite_token,
    delivery_id: row.delivery_id,
    label: label.trim(),
    holder_email: holderEmail.trim().toLowerCase(),
    holder_phone: holderPhone?.trim() || null,
    role,
    status: "pending"
  };
}

export async function requeueKeyHolderInvite(holderId) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { data, error } = await sb.rpc("requeue_key_holder_invite", { p_holder_id: holderId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invite_token || !row?.delivery_id) throw new Error("Invite resend returned an incomplete response");
  return row;
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
    role: holder.role || CIRCLE_ROLES.TRUSTED,
    roleLabel: roleLabelForHolder(holder),
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
 * so the owner can share it manually in this release.
 */
export async function sendInviteEmail({ deliveryId }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  if (!deliveryId) throw new Error("Invite delivery id is required");
  const sb = getSupabase();
  const { data, error } = await sb.functions.invoke("send-key-holder-invite", {
    body: { delivery_id: deliveryId }
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
export async function buildCircleActivationPayload({ rawVaultKey, holders, instructions = "" }) {
  const readiness = validateCircleForActivation(holders);
  if (!readiness.ok) throw new Error(readiness.reason);

  const primary = holders.find((holder) => holder.role === CIRCLE_ROLES.PRIMARY);
  const backup = holders.find((holder) => holder.role === CIRCLE_ROLES.BACKUP);
  const plan = await createRecipientGatedPlan({
    rawVaultKey,
    holderPublicKeys: holders.map((holder) => holder.release_pubkey),
    primaryPublicKey: primary.release_pubkey,
    backupPublicKey: backup.release_pubkey
  });
  const instructionBytes = new TextEncoder().encode(instructions.trim());
  try {
    const [primaryInstructions, backupInstructions] = await Promise.all([
      sealShareToPubkey(instructionBytes, primary.release_pubkey),
      sealShareToPubkey(instructionBytes, backup.release_pubkey)
    ]);
    return {
      algorithm: plan.algorithm,
      shares: plan.sealedShares.map((sealed, index) => ({
        holder_id: holders[index].id,
        share_index: index + 1,
        ciphertext: sealed.ciphertext,
        ephemeral_pub: sealed.ephemeralPub,
        commitment: plan.shareCommitments[index]
      })),
      primary: {
        holder_id: primary.id,
        ciphertext: plan.primaryGateEnvelope.ciphertext,
        ephemeral_pub: plan.primaryGateEnvelope.ephemeralPub,
        instructions_ciphertext: primaryInstructions.ciphertext,
        instructions_ephemeral_pub: primaryInstructions.ephemeralPub
      },
      backup: {
        holder_id: backup.id,
        ciphertext: plan.backupGateEnvelope.ciphertext,
        ephemeral_pub: plan.backupGateEnvelope.ephemeralPub,
        instructions_ciphertext: backupInstructions.ciphertext,
        instructions_ephemeral_pub: backupInstructions.ephemeralPub
      }
    };
  } finally {
    instructionBytes.fill(0);
  }
}

export async function activateCircleGeneration({ rawVaultKey, holders, instructions = "" }) {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const payload = await buildCircleActivationPayload({ rawVaultKey, holders, instructions });
  const sb = getSupabase();
  const { data, error } = await sb.rpc("activate_circle_generation", { p_payload: payload });
  if (error) throw error;
  return { generationId: data, sharesUploaded: payload.shares.length };
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
  const row = data[0];
  return {
    ...row,
    label: row.label ?? row.holder_label,
    role: row.role ?? row.holder_role
  };
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

function roleLabelForHolder(holder) {
  if (holder?.role === CIRCLE_ROLES.PRIMARY) return "Primary";
  if (holder?.role === CIRCLE_ROLES.BACKUP) return "Backup";
  return "Trusted";
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
    .select("id, owner_id, label, role, status")
    .eq("holder_user_id", userData.user.id)
    .eq("status", "verified");

  if (!myHolders || myHolders.length === 0) return [];
  const ownerIds = myHolders.map((h) => h.owner_id);

  // Then find active release requests against those owners
  const { data: requests } = await sb
    .from("release_requests")
    .select("*")
    .in("owner_id", ownerIds)
    .in("state", ["collecting_support", "holding", "approved", "awaiting_shares"]);

  if (!requests) return [];

  // Stitch holder info onto each request
  const contextByRequest = new Map();
  await Promise.all(requests.map(async (req) => {
    const rpcName = req.recipient_holder_id ? "recipient_gated_holder_context" : "holder_release_context";
    const { data, error } = await sb.rpc(rpcName, { p_request_id: req.id });
    if (!error) contextByRequest.set(req.id, data ?? []);
  }));

  return requests.map((req) => {
    const holder = myHolders.find((h) => h.owner_id === req.owner_id);
    const context = contextByRequest.get(req.id) ?? [];
    return {
      ...req,
      myHolderId: holder?.id,
      myLabel: holder?.label,
      iAlreadyReleased: Boolean(context.find((item) => item.holder_id === holder?.id)?.share_released),
      holderContext: context,
      recipientPubkey: context[0]?.recipient_pubkey ?? req.release_process_pubkey
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
export async function releaseMyShare({ requestId, holderId, ownerId, recipientPubkey, passphrase, holderUserId, recipientGated = true }) {
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
  if (!recipientPubkey) throw new Error("The recovery recipient key is unavailable");
  let sealed;
  try {
    sealed = await sealShareToPubkey(shareBytes, recipientPubkey);
  } finally {
    shareBytes.fill(0);
  }

  // 5. Upload via RPC (atomic: insert + maybe advance state)
  const rpc = recipientGated
    ? ["release_supporting_share", {
        p_request_id: requestId,
        p_ciphertext: sealed.ciphertext,
        p_ephemeral_pub: sealed.ephemeralPub
      }]
    : ["holder_release_share", {
        p_request_id: requestId,
        p_share_index: shareRow.share_index,
        p_ciphertext: sealed.ciphertext,
        p_ephemeral_pub: sealed.ephemeralPub
      }];
  const { error: rpcErr } = await sb.rpc(rpc[0], rpc[1]);
  if (rpcErr) throw rpcErr;

  return { shareIndex: shareRow.share_index };
}

export async function refuseRecoverySupport(requestId, reason = "") {
  if (!isSupabaseConfigured()) throw new Error("Cloud sync not configured");
  const sb = getSupabase();
  const { error } = await sb.rpc("refuse_recovery_support", {
    p_request_id: requestId,
    p_reason: reason.trim() || null
  });
  if (error) throw error;
}
