import { isBackupStale } from "./stage2BackupReminders.js";

export const BACKUP_HEALTH_STATUSES = [
  "missing",
  "exported_unverified",
  "verified_current",
  "verified_stale",
  "verification_failed",
  "unknown_after_restore"
];

export function createDefaultBackupHealth() {
  return {
    status: "missing",
    lastExportedAt: null,
    lastVerifiedAt: null,
    lastVerifiedBackupId: null,
    lastVerifiedVaultUpdatedAt: null,
    lastVerifiedRecordCount: 0,
    lastVerifiedAttachmentCount: 0,
    lastVerificationFailureReason: null,
    lastKnownEncryptedPayloadBytes: 0,
    lastVaultChangeReason: null,
    lastReminderShownAt: null
  };
}

export function deriveBackupHealth({ currentVault, storedHealth, changeReason = null, now = new Date().toISOString() } = {}) {
  const health = normalizeBackupHealth(storedHealth);
  if (health.status !== "verified_current") return health;

  const currentUpdatedAt = getVaultUpdatedAt(currentVault);
  if (isBackupStale({
    currentVaultUpdatedAt: currentUpdatedAt,
    lastVerifiedVaultUpdatedAt: health.lastVerifiedVaultUpdatedAt,
    lastVaultChangeReason: changeReason
  }) || isAfter(currentUpdatedAt, health.lastVerifiedVaultUpdatedAt)) {
    return {
      ...health,
      status: "verified_stale",
      lastVaultChangeReason: changeReason ?? "vault_changed",
      lastReminderShownAt: now
    };
  }

  return health;
}

export function markBackupExported({ health, manifest }) {
  return {
    ...normalizeBackupHealth(health),
    status: "exported_unverified",
    lastExportedAt: manifest?.exportedAt ?? new Date().toISOString(),
    lastVerificationFailureReason: null,
    lastKnownEncryptedPayloadBytes: manifest?.encryptedPayloadBytes ?? 0
  };
}

export function markBackupVerified({ health, verificationResult, currentVault, now = new Date().toISOString() }) {
  const metadata = verificationResult?.metadata ?? {};
  return {
    ...normalizeBackupHealth(health),
    status: "verified_current",
    lastExportedAt: metadata.sourceExportedAt ?? metadata.exportedAt ?? normalizeBackupHealth(health).lastExportedAt,
    lastVerifiedAt: now,
    lastVerifiedBackupId: verificationResult?.manifest?.backupId ?? null,
    lastVerifiedVaultUpdatedAt: getVaultUpdatedAt(currentVault) ?? metadata.updatedAt ?? null,
    lastVerifiedRecordCount: metadata.recordCount ?? 0,
    lastVerifiedAttachmentCount: metadata.attachmentCount ?? 0,
    lastVerificationFailureReason: null,
    lastVaultChangeReason: null,
    lastReminderShownAt: null,
    lastKnownEncryptedPayloadBytes: metadata.encryptedPayloadBytes ?? normalizeBackupHealth(health).lastKnownEncryptedPayloadBytes
  };
}

export function markBackupVerificationFailed({ health, reason, now = new Date().toISOString() }) {
  return {
    ...normalizeBackupHealth(health),
    status: "verification_failed",
    lastVerifiedAt: null,
    lastVerificationFailureReason: String(reason ?? "verification_failed").slice(0, 80),
    lastFailureAt: now
  };
}

export function markBackupUnknownAfterRestore({ health, now = new Date().toISOString() }) {
  return {
    ...createDefaultBackupHealth(),
    status: "unknown_after_restore",
    lastRestoredAt: now,
    lastKnownEncryptedPayloadBytes: normalizeBackupHealth(health).lastKnownEncryptedPayloadBytes
  };
}

export function getBackupHealthCopy(health) {
  const normalized = normalizeBackupHealth(health);
  const copy = {
    missing: {
      eyebrow: "Backup health",
      title: "No verified backup yet",
      body: "This browser has no backup record. Export an encrypted backup before relying on this vault.",
      primaryAction: "Export encrypted backup"
    },
    exported_unverified: {
      eyebrow: "Backup health",
      title: "Backup exported, not verified",
      body: "A backup file was exported, but it is not verified until OS-One confirms that it opens with your phrase or recovery key.",
      primaryAction: "Verify backup"
    },
    verified_current: {
      eyebrow: "Backup health",
      title: "Backup verified",
      body: "A backup opened successfully for this vault state. This is not permanent protection; future changes need a fresh export.",
      primaryAction: "Preview backup"
    },
    verified_stale: {
      eyebrow: "Backup health",
      title: "Vault changed after backup",
      body: "Your local vault has changed since the last verified backup. Export a fresh encrypted backup before relying on it.",
      primaryAction: "Export fresh backup"
    },
    verification_failed: {
      eyebrow: "Backup health",
      title: "Backup verification failed",
      body: "The selected backup did not verify. Your local vault was not changed.",
      primaryAction: "Try another file"
    },
    unknown_after_restore: {
      eyebrow: "Backup health",
      title: "Backup status unknown after restore",
      body: "This vault was restored or imported. Verify a backup file before relying on recovery from this browser.",
      primaryAction: "Verify backup"
    }
  };

  return copy[normalized.status] ?? copy.missing;
}

export function normalizeBackupHealth(value) {
  const defaults = createDefaultBackupHealth();
  if (!value || typeof value !== "object") return defaults;
  const status = BACKUP_HEALTH_STATUSES.includes(value.status) ? value.status : defaults.status;
  return {
    ...defaults,
    ...value,
    status,
    lastVaultChangeReason: typeof value.lastVaultChangeReason === "string" ? value.lastVaultChangeReason : defaults.lastVaultChangeReason,
    lastReminderShownAt: typeof value.lastReminderShownAt === "string" ? value.lastReminderShownAt : defaults.lastReminderShownAt,
    lastKnownEncryptedPayloadBytes: Number.isFinite(value.lastKnownEncryptedPayloadBytes) ? value.lastKnownEncryptedPayloadBytes : defaults.lastKnownEncryptedPayloadBytes,
    lastVerifiedRecordCount: Number.isFinite(value.lastVerifiedRecordCount) ? value.lastVerifiedRecordCount : defaults.lastVerifiedRecordCount,
    lastVerifiedAttachmentCount: Number.isFinite(value.lastVerifiedAttachmentCount) ? value.lastVerifiedAttachmentCount : defaults.lastVerifiedAttachmentCount
  };
}

function getVaultUpdatedAt(currentVault) {
  return currentVault?.updatedAt ?? currentVault?.vaultUpdatedAt ?? currentVault?.record?.updatedAt ?? null;
}

function isAfter(candidate, reference) {
  if (!candidate || !reference) return false;
  return new Date(candidate).getTime() > new Date(reference).getTime();
}
