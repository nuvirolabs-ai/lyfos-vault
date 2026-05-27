// Server-side encrypted vault sync. The server NEVER sees plaintext —
// this module operates on the encrypted envelope the client produces
// via packages/crypto.
//
// Wire-up plan (not yet active in main.jsx):
//   - After local save: pushEncryptedBlob({ ...envelope })
//   - On unlock for a logged-in user: fetchEncryptedBlob() and merge
//     last-write-wins by client_updated_at
//   - Conflict UI lands when we add CRDTs later

import { getSupabase, isSupabaseConfigured } from "./supabaseClient.js";

export async function fetchEncryptedBlob() {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from("vault_blobs")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function pushEncryptedBlob({
  ciphertext,         // base64 string OR Uint8Array — supabase-js handles bytea via base64
  iv,
  kdf,
  kdfSalt,
  kdfParams,
  version,
  sizeBytes,
  clientUpdatedAt
}) {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data: user } = await sb.auth.getUser();
  if (!user?.user?.id) throw new Error("Not signed in");

  const payload = {
    user_id: user.user.id,
    ciphertext,
    iv,
    algorithm: "AES-GCM",
    kdf,
    kdf_salt: kdfSalt,
    kdf_params: kdfParams,
    version,
    size_bytes: sizeBytes,
    client_updated_at: clientUpdatedAt
  };

  const { data, error } = await sb
    .from("vault_blobs")
    .upsert(payload, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEncryptedBlob() {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase();
  const { error } = await sb.from("vault_blobs").delete().neq("user_id", "00000000-0000-0000-0000-000000000000");
  // The .neq is a Postgres-friendly way to scope the delete to "all rows
  // visible to me" — which is exactly the one row for this user given the
  // RLS policy. Without a where clause supabase-js refuses to send.
  if (error) throw error;
}

export async function listDevices() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from("devices")
    .select("*")
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function registerOrTouchDevice({ deviceToken, label }) {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data: user } = await sb.auth.getUser();
  if (!user?.user?.id) throw new Error("Not signed in");

  const ua = typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 250) : "unknown";
  const { data, error } = await sb
    .from("devices")
    .upsert(
      {
        user_id: user.user.id,
        device_token: deviceToken,
        label,
        user_agent: ua,
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "user_id,device_token" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
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
