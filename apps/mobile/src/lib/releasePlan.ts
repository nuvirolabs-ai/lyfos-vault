import { getSupabase, isSupabaseConfigured } from "./supabase";
import {
  splitVaultKey
} from "./vaultRecord";
import {
  deriveHolderKeypairFromPassphrase,
  sealShareToPubkey,
  openSealedShare,
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
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createKeyHolderInvite({ label, holderEmail, holderPhone }: { label: string; holderEmail: string; holderPhone?: string }) {
  const sb = getSupabase()!;
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in");
  const invite_token = makeInviteToken();
  const { data, error } = await sb
    .from("key_holders")
    .insert({
      owner_id: u.user.id,
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

export async function revokeKeyHolder(id: string) {
  const sb = getSupabase()!;
  const { error } = await sb
    .from("key_holders")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function sendInviteEmail(inviteId: string) {
  const sb = getSupabase()!;
  const { data, error } = await sb.functions.invoke("send-key-holder-invite", { body: { invite_id: inviteId } });
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

export async function finalizeReleasePlan({ rawVaultKey, holders }: { rawVaultKey: Uint8Array; holders: any[] }) {
  if (!Array.isArray(holders) || holders.length !== 5) throw new Error("Need exactly 5 accepted holders to finalize");
  for (const h of holders) {
    if (h.status !== "accepted") throw new Error(`Holder ${h.label} is in status "${h.status}", expected "accepted"`);
    if (!h.release_pubkey) throw new Error(`Holder ${h.label} has not uploaded a release public key yet`);
  }
  const sb = getSupabase()!;
  const { data: u } = await sb.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in");

  const shares = splitVaultKey(rawVaultKey);
  const ownerId = u.user.id;
  const rows: any[] = [];
  for (let i = 0; i < 5; i++) {
    const h = holders[i];
    const sealed = sealShareToPubkey(utf8(shares[i]), h.release_pubkey);
    rows.push({
      owner_id: ownerId,
      key_holder_id: h.id,
      share_index: i + 1,
      ciphertext: sealed.ciphertext,
      ephemeral_pub: sealed.ephemeralPub
    });
  }
  const { error: delErr } = await sb.from("key_shares").delete().eq("owner_id", ownerId);
  if (delErr) throw delErr;
  const { error: insErr } = await sb.from("key_shares").insert(rows);
  if (insErr) throw insErr;
  for (const h of holders) {
    const { error: vErr } = await sb.rpc("mark_holder_verified", { p_holder_id: h.id });
    if (vErr) throw vErr;
  }
  return { sharesUploaded: rows.length };
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

function makeInviteToken(): string {
  const bytes = new Uint8Array(16);
  const g = (globalThis as any).crypto;
  if (g?.getRandomValues) g.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  // base64-url encoding
  // @ts-ignore
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
