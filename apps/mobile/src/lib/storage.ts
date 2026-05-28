// Storage adapters for the mobile app.
//
// Two tiers:
//   - SecureStore (Keychain on iOS / Keystore on Android) for the
//     encrypted vault record + biometric-protected secrets. Strict
//     size limit on iOS (~2 KB per value) — for the full vault blob
//     we shard or fall back to FileSystem.
//   - AsyncStorage for non-secret state (auto-lock policy, device
//     token, pending audit events, backup health).
//
// On the web the vault record was a single localStorage key. We
// preserve the JSON shape so the shared libs (vaultSync, audit, etc)
// work unchanged.

import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const VAULT_RECORD_KEY = "lyfos-vault-record-v1";
const VAULT_RECORD_CHUNK_PREFIX = "lyfos-vault-chunk-";
const CHUNK_SIZE = 1800; // bytes — keep well under iOS SecureStore 2KB limit
const BACKUP_HEALTH_KEY = "lyfos-backup-health-v1";
const AUTO_LOCK_KEY     = "lyfos-auto-lock-v1";
const PENDING_AUDIT_KEY = "lyfos-pending-audit-v1";
const DEVICE_TOKEN_KEY  = "lyfos-device-token-v1";
const BIOMETRIC_KEY     = "lyfos-biometric-enabled-v1";

// ============================================================
// Vault record — sharded across SecureStore keys
// ============================================================
export async function loadVaultRecord(): Promise<any | null> {
  const meta = await SecureStore.getItemAsync(VAULT_RECORD_KEY);
  if (!meta) return null;
  if (meta.startsWith("{")) return JSON.parse(meta); // small enough to fit in one key

  // Sharded: meta is a count, chunks are 0..n-1
  const count = parseInt(meta, 10);
  if (!Number.isFinite(count)) return null;
  let buf = "";
  for (let i = 0; i < count; i++) {
    const chunk = await SecureStore.getItemAsync(VAULT_RECORD_CHUNK_PREFIX + i);
    if (chunk == null) return null;
    buf += chunk;
  }
  try { return JSON.parse(buf); } catch { return null; }
}

export async function saveVaultRecord(record: any): Promise<void> {
  const json = JSON.stringify(record);
  if (json.length <= CHUNK_SIZE) {
    await SecureStore.setItemAsync(VAULT_RECORD_KEY, json);
    // Clear stale shards if previously larger
    const oldCount = await SecureStore.getItemAsync(VAULT_RECORD_KEY + ".count");
    if (oldCount) await clearShards(parseInt(oldCount, 10));
    return;
  }
  // Shard
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += CHUNK_SIZE) {
    chunks.push(json.slice(i, i + CHUNK_SIZE));
  }
  for (let i = 0; i < chunks.length; i++) {
    await SecureStore.setItemAsync(VAULT_RECORD_CHUNK_PREFIX + i, chunks[i]);
  }
  await SecureStore.setItemAsync(VAULT_RECORD_KEY, String(chunks.length));
  await SecureStore.setItemAsync(VAULT_RECORD_KEY + ".count", String(chunks.length));
}

export async function clearVaultRecord(): Promise<void> {
  const meta = await SecureStore.getItemAsync(VAULT_RECORD_KEY);
  await SecureStore.deleteItemAsync(VAULT_RECORD_KEY);
  await SecureStore.deleteItemAsync(VAULT_RECORD_KEY + ".count");
  if (meta && /^\d+$/.test(meta)) await clearShards(parseInt(meta, 10));
}

async function clearShards(n: number) {
  for (let i = 0; i < n; i++) {
    await SecureStore.deleteItemAsync(VAULT_RECORD_CHUNK_PREFIX + i);
  }
}

// ============================================================
// Generic key-value helpers — backed by AsyncStorage (non-secret)
// ============================================================
async function get<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
async function set<T>(key: string, value: T): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export const loadBackupHealth = () => get(BACKUP_HEALTH_KEY, null);
export const saveBackupHealth = (h: any) => set(BACKUP_HEALTH_KEY, h);

export const loadAutoLockMs = () => get(AUTO_LOCK_KEY, 300_000); // 5 min default
export const saveAutoLockMs = (ms: number) => set(AUTO_LOCK_KEY, ms);

export async function ensureDeviceToken(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_TOKEN_KEY);
  if (existing) return existing;
  // Generate UUID v4 using crypto polyfill (loaded at App entry)
  const id = (globalThis as any).crypto?.randomUUID?.() ?? makeFallbackUuid();
  await AsyncStorage.setItem(DEVICE_TOKEN_KEY, id);
  return id;
}
export const getDeviceToken = () => AsyncStorage.getItem(DEVICE_TOKEN_KEY);

export const loadBiometricEnabled  = () => get(BIOMETRIC_KEY, false);
export const saveBiometricEnabled  = (v: boolean) => set(BIOMETRIC_KEY, v);

export const loadPendingAuditEvents = () => get(PENDING_AUDIT_KEY, [] as any[]);
export const savePendingAuditEvents = (arr: any[]) => set(PENDING_AUDIT_KEY, arr);
export async function drainPendingAuditEvents(): Promise<any[]> {
  const arr = await loadPendingAuditEvents();
  await savePendingAuditEvents([]);
  return arr ?? [];
}

function makeFallbackUuid() {
  // Last-resort UUID v4 if crypto polyfill missed for some reason
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
