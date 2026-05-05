import { randomId, validateBackupRecord } from "./stage1Crypto.js";

export const STAGE2_BACKUP_KIND = "os-one-encrypted-backup";
export const STAGE2_BACKUP_SCHEMA_VERSION = 2;
export const DEFAULT_STAGE2_APP_VERSION = "stage2-beta";

export function createStage2BackupManifest({
  encryptedVaultContainer,
  vaultSnapshot,
  exportedAt = new Date().toISOString(),
  appVersion = DEFAULT_STAGE2_APP_VERSION
}) {
  const validation = validateBackupRecord(encryptedVaultContainer);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  return {
    kind: STAGE2_BACKUP_KIND,
    backupSchemaVersion: STAGE2_BACKUP_SCHEMA_VERSION,
    backupId: randomId(),
    vaultId: encryptedVaultContainer.vaultId ?? randomId(),
    exportedAt,
    createdByAppVersion: appVersion,
    encryptedPayloadBytes: getEncryptedByteSize(encryptedVaultContainer.encryptedVault),
    encryptedAttachmentBytes: 0,
    recordCount: countRecords(vaultSnapshot),
    attachmentCount: countAttachments(vaultSnapshot),
    auditEventCount: countAuditEvents(vaultSnapshot),
    kdfName: getKdfName(encryptedVaultContainer),
    encryptedVaultContainer
  };
}

export function prepareStage2BackupExport({
  encryptedVaultContainer,
  vaultSnapshot,
  exportedAt = new Date().toISOString(),
  appVersion = DEFAULT_STAGE2_APP_VERSION
}) {
  const manifest = createStage2BackupManifest({
    encryptedVaultContainer,
    vaultSnapshot,
    exportedAt,
    appVersion
  });
  const text = JSON.stringify(manifest, null, 2);

  return {
    filename: "os-one-stage2-encrypted-vault-backup.json",
    text,
    manifest,
    encryptedPayloadBytes: getEncryptedByteSize(manifest)
  };
}

export function validateStage2BackupManifest(value) {
  if (value?.kind !== STAGE2_BACKUP_KIND) {
    return { ok: false, reason: "This is not an OS-One Stage 2 encrypted backup manifest." };
  }

  if (value.backupSchemaVersion !== STAGE2_BACKUP_SCHEMA_VERSION) {
    return { ok: false, reason: "Unsupported OS-One backup manifest version." };
  }

  if (!value.encryptedVaultContainer) {
    return { ok: false, reason: "The backup manifest is missing encrypted vault data." };
  }

  const recordValidation = validateBackupRecord(value.encryptedVaultContainer);
  if (!recordValidation.ok) return recordValidation;

  for (const field of [
    "backupId",
    "vaultId",
    "exportedAt",
    "createdByAppVersion",
    "kdfName"
  ]) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      return { ok: false, reason: `The backup manifest is missing ${field}.` };
    }
  }

  for (const field of [
    "encryptedPayloadBytes",
    "encryptedAttachmentBytes",
    "recordCount",
    "attachmentCount",
    "auditEventCount"
  ]) {
    if (!Number.isFinite(value[field]) || value[field] < 0) {
      return { ok: false, reason: `The backup manifest has an invalid ${field}.` };
    }
  }

  return { ok: true };
}

export function isStage2BackupManifest(value) {
  return validateStage2BackupManifest(value).ok;
}

export function normalizeImportedBackup(value) {
  if (value?.kind === STAGE2_BACKUP_KIND) {
    const validation = validateStage2BackupManifest(value);
    if (!validation.ok) return validation;
    return {
      ok: true,
      record: value.encryptedVaultContainer,
      sourceFormat: "stage2-manifest",
      manifest: value
    };
  }

  const validation = validateBackupRecord(value);
  if (!validation.ok) return validation;
  return {
    ok: true,
    record: value,
    sourceFormat: "stage1-direct",
    manifest: null
  };
}

export function getBackupFormatLabel(value) {
  if (value?.kind === STAGE2_BACKUP_KIND) return "Stage 2 encrypted backup manifest";
  if (validateBackupRecord(value).ok) return "Stage 1 direct encrypted vault";
  return "Unknown backup format";
}

export function getEncryptedByteSize(value) {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
}

function countRecords(vaultSnapshot) {
  return Array.isArray(vaultSnapshot?.items) ? vaultSnapshot.items.length : 0;
}

function countAttachments(vaultSnapshot) {
  return (vaultSnapshot?.items ?? []).reduce((total, item) => total + (item.attachments?.length ?? 0), 0);
}

function countAuditEvents(vaultSnapshot) {
  return Array.isArray(vaultSnapshot?.audit) ? vaultSnapshot.audit.length : 0;
}

function getKdfName(encryptedVaultContainer) {
  return encryptedVaultContainer?.crypto?.keyWrap
    ?? encryptedVaultContainer?.keyEnvelopes?.passphrase?.kdf?.name
    ?? "unknown";
}
