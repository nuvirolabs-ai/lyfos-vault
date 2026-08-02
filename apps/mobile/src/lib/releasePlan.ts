import { getSupabase, isSupabaseConfigured } from "./supabase";
import {
  splitVaultKey
} from "./vaultRecord";
import {
  deriveHolderKeypairFromPassphrase,
  sealShareToPubkey,
  openSealedShare,
  randomBytes,
  sha256Hex,
  utf8,
  fromUtf8
} from "./crypto";

export async function listMyKeyHolders() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase()!;
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) return [];
  const { data, error } = await sb
    .from("key_holders")
    .select("*")
    .eq("owner_id", u.user.id)
    .neq("status", "revoked")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const holders = data ?? [];
  if (holders.length === 0) return holders;
  const { data: deliveries, error: deliveryError } = await sb
    .from("email_deliveries")
    .select("related_holder_id, state, failure_reason, attempt, updated_at")
    .in("related_holder_id", holders.map((holder: any) => holder.id))
    .eq("purpose", "holder_invite")
    .order("attempt", { ascending: false })
    .order("updated_at", { ascending: false });
  if (deliveryError) throw deliveryError;
  return mergeLatestInviteDeliveries(holders, deliveries ?? []);
}

export function mergeLatestInviteDeliveries(holders: any[] = [], deliveries: any[] = []) {
  const latestByHolder = new Map<string, any>();
  for (const delivery of deliveries) {
    const holderId = delivery?.related_holder_id;
    if (!holderId) continue;
    const current = latestByHolder.get(holderId);
    const attempt = Number(delivery.attempt) || 0;
    const currentAttempt = Number(current?.attempt) || 0;
    if (!current
      || attempt > currentAttempt
      || (attempt === currentAttempt && String(delivery.updated_at ?? "") > String(current.updated_at ?? ""))) {
      latestByHolder.set(holderId, delivery);
    }
  }
  return holders.map((holder) => {
    const delivery = latestByHolder.get(holder.id);
    return {
      ...holder,
      delivery_state: delivery?.state ?? null,
      delivery_failure_reason: delivery?.failure_reason ?? null,
      delivery_updated_at: delivery?.updated_at ?? null
    };
  });
}

export async function createKeyHolderInvite({ label, holderEmail, holderPhone, role }: { label: string; holderEmail: string; holderPhone?: string; role: "primary" | "backup" | "trusted" }) {
  const sb = getSupabase()!;
  const { data, error } = await sb.rpc("create_key_holder_invite", {
    p_holder_email: holderEmail.trim().toLowerCase(),
    p_holder_phone: holderPhone?.trim() || null,
    p_label: label.trim(),
    p_role: role
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invite_id || !row?.invite_token || !row?.delivery_id) throw new Error("Invite service returned an incomplete response");
  return { id: row.invite_id, invite_token: row.invite_token, delivery_id: row.delivery_id, role };
}

export async function revokeKeyHolder(id: string) {
  const sb = getSupabase()!;
  const { error } = await sb
    .from("key_holders")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function requeueKeyHolderInvite(holderId: string) {
  const sb = getSupabase()!;
  const { data, error } = await sb.rpc("requeue_key_holder_invite", { p_holder_id: holderId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.invite_token || !row?.delivery_id) throw new Error("Invite resend returned an incomplete response");
  return row;
}

export async function sendInviteEmail(deliveryId: string) {
  const sb = getSupabase()!;
  const { data, error } = await sb.functions.invoke("send-key-holder-invite", { body: { delivery_id: deliveryId } });
  if (error) throw error;
  return data;
}

export async function peekInvite(token: string) {
  const sb = getSupabase()!;
  const { data, error } = await sb.rpc("peek_invite", { p_token: token });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0];
}

export async function acceptInvite({ token, releasePubkey }: { token: string; releasePubkey: string }) {
  const sb = getSupabase()!;
  const { data, error } = await sb.rpc("accept_invite", {
    p_token: token,
    p_release_pubkey: releasePubkey
  });
  if (error) throw error;
  return data;
}

export async function finalizeReleasePlan({ rawVaultKey, holders, instructions = "" }: { rawVaultKey: Uint8Array; holders: any[]; instructions?: string }) {
  if (!Array.isArray(holders) || holders.length !== 5) throw new Error("Need exactly 5 accepted holders to finalize");
  for (const h of holders) {
    if (!["accepted", "verified"].includes(h.status)) throw new Error(`Holder ${h.label} is not ready`);
    if (!h.release_pubkey) throw new Error(`Holder ${h.label} has not uploaded a release public key yet`);
  }
  const primary = holders.find((h) => h.role === "primary");
  const backup = holders.find((h) => h.role === "backup");
  if (!primary || !backup || primary.id === backup.id) throw new Error("Choose one primary and one backup nominee before activation");
  const sb = getSupabase()!;
  const gate = randomBytes(32);
  const masked = new Uint8Array(32);
  const instructionBytes = utf8(instructions.trim());
  for (let i = 0; i < 32; i++) masked[i] = rawVaultKey[i] ^ gate[i];
  try {
    const shares = splitVaultKey(masked, { total: 5, threshold: 2 });
    const sealedShares = shares.map((share, index) => {
      const bytes = utf8(share);
      const sealed = sealShareToPubkey(bytes, holders[index].release_pubkey);
      return {
        holder_id: holders[index].id,
        share_index: index + 1,
        ciphertext: sealed.ciphertext,
        ephemeral_pub: sealed.ephemeralPub,
        commitment: sha256Hex(bytes)
      };
    });
    const primaryGate = sealShareToPubkey(gate, primary.release_pubkey);
    const backupGate = sealShareToPubkey(gate, backup.release_pubkey);
    const primaryInstructions = sealShareToPubkey(instructionBytes, primary.release_pubkey);
    const backupInstructions = sealShareToPubkey(instructionBytes, backup.release_pubkey);
    const payload = {
      algorithm: "recipient-gate-xor-sss-2of5-v1",
      shares: sealedShares,
      primary: {
        holder_id: primary.id,
        ciphertext: primaryGate.ciphertext,
        ephemeral_pub: primaryGate.ephemeralPub,
        instructions_ciphertext: primaryInstructions.ciphertext,
        instructions_ephemeral_pub: primaryInstructions.ephemeralPub
      },
      backup: {
        holder_id: backup.id,
        ciphertext: backupGate.ciphertext,
        ephemeral_pub: backupGate.ephemeralPub,
        instructions_ciphertext: backupInstructions.ciphertext,
        instructions_ephemeral_pub: backupInstructions.ephemeralPub
      }
    };
    const { data, error } = await sb.rpc("activate_circle_generation", { p_payload: payload });
    if (error) throw error;
    return { generationId: data, sharesUploaded: sealedShares.length };
  } finally {
    gate.fill(0);
    masked.fill(0);
    instructionBytes.fill(0);
  }
}

// ============================================================
// Key holder release-share (mobile equivalent of releaseMyShare on web)
// ============================================================
export async function listReleasesAwaitingMyAction() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase()!;
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) return [];

  const { data: myHolders } = await sb
    .from("key_holders")
    .select("id, owner_id, label, status")
    .eq("holder_user_id", u.user.id)
    .eq("status", "verified");
  if (!myHolders?.length) return [];
  const ownerIds = myHolders.map((h: any) => h.owner_id);

  const { data: requests } = await sb
    .from("release_requests").select("*")
    .in("owner_id", ownerIds)
    .in("state", ["approved", "awaiting_shares", "holding"]);
  if (!requests?.length) return [];

  const ids = requests.map((r: any) => r.id);
  const { data: alreadyReleased } = await sb
    .from("release_share_releases")
    .select("release_request_id, key_holder_id")
    .in("release_request_id", ids);
  const releasedSet = new Set((alreadyReleased ?? []).map((r: any) => `${r.release_request_id}:${r.key_holder_id}`));

  return requests.map((req: any) => {
    const holder = myHolders.find((h: any) => h.owner_id === req.owner_id);
    return {
      ...req,
      myHolderId: holder?.id,
      myLabel: holder?.label,
      iAlreadyReleased: holder ? releasedSet.has(`${req.id}:${holder.id}`) : false
    };
  });
}

export async function releaseMyShare(params: {
  requestId: string;
  holderId: string;
  ownerId: string;
  releaseProcessPubkey: string;
  passphrase: string;
  holderUserId: string;
}) {
  const sb = getSupabase()!;
  if (!params.passphrase || params.passphrase.length < 12) throw new Error("Passphrase required (min 12 chars)");

  const { data: shareRow, error: shareErr } = await sb
    .from("key_shares")
    .select("share_index, ciphertext, ephemeral_pub")
    .eq("owner_id", params.ownerId)
    .eq("key_holder_id", params.holderId)
    .maybeSingle();
  if (shareErr) throw shareErr;
  if (!shareRow) throw new Error("Couldn't find your share for this owner");

  const myKp = await deriveHolderKeypairFromPassphrase(params.passphrase, params.holderUserId);
  let shareBytes: Uint8Array;
  try {
    shareBytes = openSealedShare(
      { ciphertext: shareRow.ciphertext, ephemeralPub: shareRow.ephemeral_pub },
      myKp.secretKey
    );
  } catch {
    throw new Error("Couldn't decrypt your share. Did you type the same passphrase you used when accepting the invite?");
  }
  const sealed = sealShareToPubkey(shareBytes, params.releaseProcessPubkey);
  for (let i = 0; i < shareBytes.length; i++) shareBytes[i] = 0;

  const { error: rpcErr } = await sb.rpc("holder_release_share", {
    p_request_id: params.requestId,
    p_share_index: shareRow.share_index,
    p_ciphertext: sealed.ciphertext,
    p_ephemeral_pub: sealed.ephemeralPub
  });
  if (rpcErr) throw rpcErr;
  return { shareIndex: shareRow.share_index };
}
