import { decryptVaultWithPassphrase, decryptVaultWithRecoveryKey } from "./stage1Crypto.js";
import { createDefaultBackupHealth, normalizeBackupHealth } from "./stage2BackupHealth.js";
import { normalizeImportedBackup } from "./stage2BackupManifest.js";

export const STAGE1_STORAGE_KEY = "os-one.stage1.local-vault.v2";
export const LEGACY_STORAGE_KEY = "os-one.local-vault.v1";
export const BACKUP_HEALTH_STORAGE_KEY = "os-one.stage2.backup-health.v1";
export const DIGITAL_LEGACY_MIGRATION_BACKUP_KEY = "os-one.digital-legacy.pre-migration-backup.v1";

export function loadStage1Record(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(STAGE1_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveStage1Record(storage = globalThis.localStorage, record) {
  storage.setItem(STAGE1_STORAGE_KEY, JSON.stringify(record));
  return record;
}

export function clearStage1Record(storage = globalThis.localStorage) {
  storage.removeItem(STAGE1_STORAGE_KEY);
  storage.removeItem(LEGACY_STORAGE_KEY);
  storage.removeItem(BACKUP_HEALTH_STORAGE_KEY);
  storage.removeItem(DIGITAL_LEGACY_MIGRATION_BACKUP_KEY);
}

// A one-time safety snapshot taken immediately before vault.digitalLegacy
// is introduced (see docs/LEGACY_RECORD_MIGRATION.md's "verified encrypted
// pre-migration backup" gate). Same encrypted-record shape as the main
// Stage 1 record, just under its own key so it survives independently of
// whatever the migration writes next.
export function saveDigitalLegacyPreMigrationBackup(storage = globalThis.localStorage, record) {
  storage.setItem(DIGITAL_LEGACY_MIGRATION_BACKUP_KEY, JSON.stringify(record));
  return record;
}

export function loadDigitalLegacyPreMigrationBackup(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(DIGITAL_LEGACY_MIGRATION_BACKUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadBackupHealth(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(BACKUP_HEALTH_STORAGE_KEY);
    return raw ? normalizeBackupHealth(JSON.parse(raw)) : createDefaultBackupHealth();
  } catch {
    return createDefaultBackupHealth();
  }
}

export function saveBackupHealth(storage = globalThis.localStorage, health) {
  const normalized = normalizeBackupHealth(health);
  storage.setItem(BACKUP_HEALTH_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function restoreStage1Backup(storage = globalThis.localStorage, backupText) {
  let record;
  try {
    record = JSON.parse(backupText);
  } catch {
    return { ok: false, reason: "Backup file is not valid JSON." };
  }

  const normalized = normalizeImportedBackup(record);
  if (!normalized.ok) return normalized;

  saveStage1Record(storage, normalized.record);
  return { ok: true, record: normalized.record };
}

export async function createRestorePreview({ backupText, secret, mode = "passphrase", currentRecord = null }) {
  let record;
  try {
    record = JSON.parse(backupText);
  } catch {
    return { ok: false, reason: "Backup file is not valid JSON." };
  }

  const normalized = normalizeImportedBackup(record);
  if (!normalized.ok) return normalized;
  record = normalized.record;

  try {
    const unlocked = mode === "recovery"
      ? await decryptVaultWithRecoveryKey(record, secret)
      : await decryptVaultWithPassphrase(record, secret);
    const vault = unlocked.vault;
    const incoming = getVaultMetadata(record, vault);
    const current = currentRecord
      ? await previewCurrentRecord({ currentRecord, secret, mode })
      : null;
    return {
      ok: true,
      record,
      vault,
      vaultKey: unlocked.vaultKey,
      metadata: incoming,
      comparison: {
        era: compareBackupEra(record.updatedAt, currentRecord?.updatedAt),
        incoming,
        current: current?.metadata ?? getRecordOnlyMetadata(currentRecord),
        currentPreviewed: Boolean(current?.metadata),
        willReplaceCurrent: Boolean(currentRecord)
      }
    };
  } catch (error) {
    return { ok: false, reason: error.message || "Could not decrypt backup preview." };
  }
}

export function compareBackupEra(incomingUpdatedAt, currentUpdatedAt) {
  if (!incomingUpdatedAt || !currentUpdatedAt) return "unknown";
  const delta = new Date(incomingUpdatedAt).getTime() - new Date(currentUpdatedAt).getTime();
  if (Math.abs(delta) < 60000) return "same-era";
  return delta > 0 ? "newer" : "older";
}

function getVaultMetadata(record, vault) {
  return {
    createdAt: record?.createdAt ?? null,
    updatedAt: record?.updatedAt ?? null,
    formatVersion: record?.version ?? null,
    recordCount: vault?.items?.length ?? 0,
    attachmentCount: (vault?.items ?? []).reduce((total, item) => total + (item.attachments?.length ?? 0), 0),
    auditEventCount: vault?.audit?.length ?? 0
  };
}

function getRecordOnlyMetadata(record) {
  if (!record) return null;
  return {
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
    formatVersion: record.version ?? null,
    recordCount: null,
    attachmentCount: null,
    auditEventCount: null
  };
}

async function previewCurrentRecord({ currentRecord, secret, mode }) {
  try {
    const unlocked = mode === "recovery"
      ? await decryptVaultWithRecoveryKey(currentRecord, secret)
      : await decryptVaultWithPassphrase(currentRecord, secret);
    return { metadata: getVaultMetadata(currentRecord, unlocked.vault) };
  } catch {
    return null;
  }
}

export function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}
