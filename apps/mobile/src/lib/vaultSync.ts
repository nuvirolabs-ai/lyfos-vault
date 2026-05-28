// Mobile vault sync — mirror of apps/web/src/lib/vaultSync.js.
// Both push/fetch the full Stage 1 record + thin metadata.

import { getSupabase, isSupabaseConfigured } from "./supabase";

export async function pushEncryptedRecord(record: any) {
  if (!isSupabaseConfigured()) return { synced: false };
  const sb = getSupabase()!;
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) return { synced: false, reason: "not_signed_in" as const };

  const sizeBytes = new TextEncoder().encode(JSON.stringify(record)).length;
  const payload = {
    user_id: userData.user.id,
    encrypted_record: record,
    version: record?.version ?? 2,
    size_bytes: sizeBytes,
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

export async function fetchEncryptedRecord() {
  if (!isSupabaseConfigured()) return { record: null, meta: null };
  const sb = getSupabase()!;
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

export function reconcileLocalAndServer({ localRecord, serverRecord }: { localRecord: any; serverRecord: any }) {
  if (!serverRecord) return { winner: "local" as const, record: localRecord, needsPush: Boolean(localRecord), needsReplaceLocal: false };
  if (!localRecord)  return { winner: "server" as const, record: serverRecord, needsPush: false, needsReplaceLocal: true };
  const lT = new Date(localRecord.updatedAt ?? 0).getTime();
  const sT = new Date(serverRecord.updatedAt ?? 0).getTime();
  if (lT > sT) return { winner: "local"  as const, record: localRecord,  needsPush: true,  needsReplaceLocal: false };
  if (sT > lT) return { winner: "server" as const, record: serverRecord, needsPush: false, needsReplaceLocal: true };
  return { winner: "tie" as const, record: localRecord, needsPush: false, needsReplaceLocal: false };
}

// ============================================================
// Devices
// ============================================================
export async function listDevices() {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase()!;
  const { data, error } = await sb
    .from("devices")
    .select("id, device_token, label, user_agent, created_at, last_seen_at, revoked_at")
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function registerOrTouchDevice({ deviceToken, label }: { deviceToken: string; label?: string }) {
  if (!isSupabaseConfigured()) return null;
  if (!deviceToken) return null;
  const sb = getSupabase()!;
  const { data: userData } = await sb.auth.getUser();
  if (!userData?.user?.id) return null;

  const ua = `Lyfos Mobile / ${process.env.EXPO_PUBLIC_PLATFORM ?? "unknown"}`;
  const { data, error } = await sb
    .from("devices")
    .upsert(
      {
        user_id: userData.user.id,
        device_token: deviceToken,
        label: label ?? "Lyfos Mobile",
        user_agent: ua,
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "user_id,device_token" }
    )
    .select()
    .single();
  if (error) return null;
  return data;
}

export async function renameDevice(deviceId: string, label: string) {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase()!;
  const { error } = await sb.from("devices").update({ label }).eq("id", deviceId);
  if (error) throw error;
}

export async function revokeDevice(deviceId: string) {
  if (!isSupabaseConfigured()) return;
  const sb = getSupabase()!;
  const { error } = await sb.from("devices").update({ revoked_at: new Date().toISOString() }).eq("id", deviceId);
  if (error) throw error;
}
