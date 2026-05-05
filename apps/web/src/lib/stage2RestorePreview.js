import { decryptVaultWithPassphrase, decryptVaultWithRecoveryKey } from "./stage1Crypto.js";
import { getBackupFormatLabel, normalizeImportedBackup } from "./stage2BackupManifest.js";

export const DESTRUCTIVE_RESTORE_CONFIRMATION = "REPLACE LOCAL VAULT";

export async function createRestoreDryRun({ backupText, secret, mode = "passphrase", currentRecord = null }) {
  let parsed;
  try {
    parsed = JSON.parse(backupText);
  } catch {
    return { ok: false, code: "invalid_shape", reason: "Backup file is not valid JSON." };
  }

  const normalized = normalizeImportedBackup(parsed);
  if (!normalized.ok) {
    return {
      ok: false,
      code: normalized.reason?.match(/unsupported/i) ? "unsupported_version" : "invalid_shape",
      reason: normalized.reason
    };
  }

  try {
    const unlocked = mode === "recovery"
      ? await decryptVaultWithRecoveryKey(normalized.record, secret)
      : await decryptVaultWithPassphrase(normalized.record, secret);
    const incomingMetadata = getVaultMetadata(normalized.record, unlocked.vault);
    const currentMetadata = getRecordOnlyMetadata(currentRecord);
    const currentPreview = currentRecord ? await tryPreviewCurrent({ currentRecord, secret, mode }) : null;
    const impact = compareRestoreImpact({
      incomingMetadata,
      currentMetadata: currentPreview ?? currentMetadata
    });

    return {
      ok: true,
      sourceFormat: normalized.sourceFormat,
      formatLabel: getBackupFormatLabel(parsed),
      record: normalized.record,
      vault: unlocked.vault,
      vaultKey: unlocked.vaultKey,
      metadata: incomingMetadata,
      impact,
      impactCopy: getRestoreImpactCopy(impact),
      destructiveConfirmation: DESTRUCTIVE_RESTORE_CONFIRMATION
    };
  } catch (error) {
    return { ok: false, code: "decrypt_failed", reason: error.message || "Could not decrypt backup preview." };
  }
}

export function compareRestoreImpact({ incomingMetadata, currentMetadata }) {
  const era = compareBackupEra(incomingMetadata?.updatedAt, currentMetadata?.updatedAt);
  return {
    era,
    incoming: normalizeMetadata(incomingMetadata),
    current: currentMetadata ? normalizeMetadata(currentMetadata) : null,
    currentPreviewed: Boolean(currentMetadata?.recordCount !== null && currentMetadata?.recordCount !== undefined),
    willReplaceCurrent: Boolean(currentMetadata)
  };
}

export function getRestoreImpactCopy(impact) {
  const eraCopy = {
    newer: "This backup appears newer than the current local vault.",
    older: "This backup appears older than the current local vault.",
    "same-era": "This backup appears from the same time window as the current local vault.",
    unknown: "OS-One can preview this backup, but cannot compare its age to the current local vault."
  };

  return {
    eyebrow: "Practice restore preview",
    summary: eraCopy[impact?.era] ?? eraCopy.unknown,
    unchanged: "Nothing has changed yet. This preview only decrypted the backup in memory.",
    destructiveWarning: impact?.willReplaceCurrent
      ? "The replace action will overwrite the encrypted local vault stored in this browser."
      : "The replace action will make this backup the local vault for this browser.",
    requiredConfirmation: DESTRUCTIVE_RESTORE_CONFIRMATION
  };
}

export function canConfirmDestructiveRestore(value) {
  return value === DESTRUCTIVE_RESTORE_CONFIRMATION;
}

function normalizeMetadata(metadata) {
  return {
    createdAt: metadata?.createdAt ?? null,
    updatedAt: metadata?.updatedAt ?? null,
    formatVersion: metadata?.formatVersion ?? null,
    recordCount: metadata?.recordCount ?? null,
    attachmentCount: metadata?.attachmentCount ?? null,
    auditEventCount: metadata?.auditEventCount ?? null
  };
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

async function tryPreviewCurrent({ currentRecord, secret, mode }) {
  try {
    const unlocked = mode === "recovery"
      ? await decryptVaultWithRecoveryKey(currentRecord, secret)
      : await decryptVaultWithPassphrase(currentRecord, secret);
    return getVaultMetadata(currentRecord, unlocked.vault);
  } catch {
    return null;
  }
}

function compareBackupEra(incomingUpdatedAt, currentUpdatedAt) {
  if (!incomingUpdatedAt || !currentUpdatedAt) return "unknown";
  const delta = new Date(incomingUpdatedAt).getTime() - new Date(currentUpdatedAt).getTime();
  if (Math.abs(delta) < 60000) return "same-era";
  return delta > 0 ? "newer" : "older";
}
