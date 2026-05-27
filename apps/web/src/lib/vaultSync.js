// Encrypted vault sync. The server holds the full Stage 1 record as
// JSONB ciphertext — it cannot decrypt anything. This module is a thin
// wrapper around Supabase that turns the local record into a sync push,
// and turns a server pull into a candidate local record.
//
// Conflict resolution (v1): last-write-wins by client_updated_at.
// The merge UI for genuine concurrent edits lands when we move to CRDTs.

import { getSupabase, isSupabaseConfigured } from "./supabaseClient.js";

/**
 * Push the current local record up to the server, encrypted as-is.
 * @param {object} record  the full Stage 1 vault record (output of createStage1VaultRecord / updateEncryptedVault)
 */
export async function pushEncryptedRecord(record) {
  if (!isSupabaseConfigured()) return { synced: false };
  const sb = getSupabase();
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user?.id) return { synced: false, reason: "not_signed_in" };

  const payload = {
    user_id: userData.user.id,
    encrypted_record: record,
    version: (record?.version ?? 2),
    size_bytes: estimateSize(record),
    client_updated_at: record?.updatedAt ?? new Date().toISOString()
  };

  const { data, error } = await sb
    .from("vault_blobs")
    .upsert(payload, { onConflict: "user_id" })
    .select("user_id, version, client_updated_at, updated_at, size_bytes")
    .single();
  if (error) throw error;
  return { synced: true, meta: data };
}

/**
 * Fetch the server copy of the user's encrypted record, if any.
 * @returns {Promise<{record: object|null, meta: object|null}>}
 */
export async function fetchEncryptedRecord() {
  if (!isSupabaseConfigured()) return { record: null, meta: null };
  const sb = getSupabase();
  const { data, error } = await sb
    .from("vault_blobs")
    .select("encrypted_record, version, size_bytes, client_updated_at, updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { record: null, meta: null };
  return {
    record: data.encrypted_record,
    meta: {
      version: data.version,
      size_bytes: data.size_bytes,
      client_updated_at: data.client_updated_at,
      server_updated_at: data.updated_at
    }
  };
}

/**
 * Decide what to use as the current vault record given a local + server copy.
 * v1 strategy: last-write-wins by updatedAt (client wall clock).
 *
 *   - No server record       → keep local
 *   - No local record        → use server
 *   - local.updatedAt newer  → keep local (server is stale; push to overwrite)
 *   - server.updatedAt newer → use server
 *
 * Returns { winner: "local"|"server"|"tie", record, needsPush, needsReplaceLocal }.
 */
export function reconcileLocalAndServer({ localRecord, serverRecord }) {
  if (!serverRecord) {
    return { winner: "local", record: localRecord, needsPush: Boolean(localRecord), needsReplaceLocal: false };
  }
  if (!localRecord) {
    return { winner: "server", record: serverRecord, needsPush: false, needsReplaceLocal: true };
  }
  const localT = new Date(localRecord.updatedAt ?? 0).getTime();
  const serverT = new Date(serverRecord.updatedAt ?? 0).getTime();
  if (localT > serverT) {
    return { winner: "local", record: localRecord, needsPush: true, needsReplaceLocal: false };
  }
  if (serverT > localT) {
    return { winner: "server", record: serverRecord, needsPush: false, needsReplaceLocal: true };
  }
  return { winner: "tie", record: localRecord, needsPush: false, needsReplaceLocal: false };
}

export async function deleteEncryptedRecord() {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) return;
  const { error } = await sb.from("vault_blobs").delete().eq("user_id", userData.user.id);
  if (error) throw error;
}

// ============================================================
// Device registry
// ============================================================

export async function listDevices() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from("devices")
    .select("id, device_token, label, user_agent, created_at, last_seen_at, revoked_at")
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function registerOrTouchDevice({ deviceToken, label } = {}) {
  if (!isSupabaseConfigured()) return null;
  if (!deviceToken) return null;
  const sb = getSupabase();
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) return null;

  const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 250) : "unknown";
  const { data, error } = await sb
    .from("devices")
    .upsert(
      {
        user_id: userData.user.id,
        device_token: deviceToken,
        label: label ?? inferDeviceLabel(ua),
        user_agent: ua,
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "user_id,device_token" }
    )
    .select()
    .single();
  if (error) {
    // Don't block the user flow on a device registry hiccup. Log and move on.
    if (typeof console !== "undefined") console.warn("[lyfos] device touch failed:", error.message);
    return null;
  }
  return data;
}

export async function renameDevice(deviceId, label) {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  const { error } = await sb.from("devices").update({ label }).eq("id", deviceId);
  if (error) throw error;
}

export async function revokeDevice(deviceId) {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  const { error } = await sb
    .from("devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", deviceId);
  if (error) throw error;
}

// ============================================================
// helpers
// ============================================================

function estimateSize(record) {
  try {
    return new TextEncoder().encode(JSON.stringify(record)).length;
  } catch {
    return 0;
  }
}

function inferDeviceLabel(ua) {
  if (!ua) return "Browser";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh/i.test(ua)) {
    if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return "Mac · Safari";
    if (/Chrome|Chromium/.test(ua)) return "Mac · Chrome";
    return "Mac";
  }
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Browser";
}
