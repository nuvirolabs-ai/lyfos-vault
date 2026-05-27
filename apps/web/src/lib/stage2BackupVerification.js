import { normalizeRecoveryKey, deriveWrappingKeyFromEnvelope } from "./stage1Crypto.js";
import { getBackupFormatLabel, normalizeImportedBackup, STAGE2_BACKUP_KIND } from "./stage2BackupManifest.js";

const decoder = new TextDecoder();

export async function verifyBackup({ backupText, secret, mode = "passphrase" }) {
  let parsed;
  try {
    parsed = JSON.parse(backupText);
  } catch (error) {
    return failure(classifyBackupVerificationError(error));
  }

  const normalized = normalizeImportedBackup(parsed);
  if (!normalized.ok) {
    return failure(classifyBackupVerificationError(new BackupVerificationError(normalized.reason, {
      parsed,
      code: classifyShapeCode(parsed, normalized.reason)
    })));
  }

  try {
    const record = normalized.record;
    const vaultKey = await unwrapVaultKeyForVerification(record, secret, mode);
    const vault = await decryptVaultPayloadForVerification(vaultKey, record.encryptedVault);
    return {
      ok: true,
      sourceFormat: normalized.sourceFormat,
      formatLabel: getBackupFormatLabel(parsed),
      usedEnvelope: mode === "recovery" ? "recovery" : "passphrase",
      metadata: buildSafeVerificationMetadata({ record, vault, manifest: normalized.manifest }),
      warning: "Verification only checks that this file decrypts. It does not prove the backup is current."
    };
  } catch (error) {
    return failure(classifyBackupVerificationError(error));
  }
}

export function classifyBackupVerificationError(error) {
  if (error instanceof SyntaxError) {
    return { code: "invalid_shape", reason: "Backup file is not valid JSON." };
  }

  if (error?.code) {
    return { code: error.code, reason: error.message };
  }

  return {
    code: "corrupted_payload",
    reason: "The backup payload could not be decrypted or is corrupted."
  };
}

class BackupVerificationError extends Error {
  constructor(message, { code, parsed } = {}) {
    super(message);
    this.code = code;
    this.parsed = parsed;
  }
}

function failure({ code, reason }) {
  return { ok: false, code, reason };
}

function classifyShapeCode(parsed, reason) {
  if (parsed?.kind === STAGE2_BACKUP_KIND && /unsupported/i.test(reason)) return "unsupported_version";
  return "invalid_shape";
}

async function unwrapVaultKeyForVerification(record, secret, mode) {
  const envelope = mode === "recovery"
    ? record?.keyEnvelopes?.recovery
    : record?.keyEnvelopes?.passphrase;

  if (!envelope?.wrappedKey || !envelope?.kdf?.salt) {
    throw new BackupVerificationError("The backup is missing the selected key envelope.", { code: "invalid_shape" });
  }

  try {
    const normalizedSecret = mode === "recovery" ? normalizeRecoveryKey(secret) : secret;
    // Shared dispatcher handles both Argon2id (new vaults) and PBKDF2 (legacy)
    // based on envelope.kdf.name.
    const wrappingKey = await deriveWrappingKeyFromEnvelope(envelope, normalizedSecret);
    const raw = await decryptJson(wrappingKey, envelope.wrappedKey, "wrong_secret");
    return globalThis.crypto.subtle.importKey(
      "raw",
      decodeBase64(raw.vaultKey),
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  } catch (error) {
    if (error?.code === "corrupted_payload" || error?.code === "invalid_shape") throw error;
    throw new BackupVerificationError("The backup could not be opened with that phrase or recovery key.", { code: "wrong_secret" });
  }
}

async function decryptVaultPayloadForVerification(vaultKey, encryptedVault) {
  return decryptJson(vaultKey, encryptedVault, "corrupted_payload");
}

async function decryptJson(key, encrypted, failureCode) {
  if (!encrypted?.iv || !encrypted?.ciphertext) {
    throw new BackupVerificationError("The encrypted backup payload is missing required data.", { code: "invalid_shape" });
  }

  try {
    const iv = decodeBase64(encrypted.iv);
    const ciphertext = decodeBase64(encrypted.ciphertext);
    const plaintext = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(decoder.decode(plaintext));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new BackupVerificationError("The decrypted backup payload is not valid OS-One data.", { code: "corrupted_payload" });
    }
    if (error?.code) throw error;
    throw new BackupVerificationError(
      failureCode === "wrong_secret"
        ? "The backup could not be opened with that phrase or recovery key."
        : "The backup payload could not be decrypted or is corrupted.",
      { code: failureCode }
    );
  }
}

function decodeBase64(value) {
  const text = String(value ?? "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new BackupVerificationError("The backup payload is not valid base64.", { code: "corrupted_payload" });
  }

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(text, "base64"));
  }

  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function buildSafeVerificationMetadata({ record, vault, manifest }) {
  return {
    backupSchemaVersion: manifest?.backupSchemaVersion ?? null,
    formatVersion: record?.version ?? null,
    sourceExportedAt: manifest?.exportedAt ?? null,
    exportedAt: manifest?.exportedAt ?? null,
    createdAt: record?.createdAt ?? null,
    updatedAt: record?.updatedAt ?? null,
    recordCount: Array.isArray(vault?.items) ? vault.items.length : 0,
    attachmentCount: (vault?.items ?? []).reduce((total, item) => total + (item.attachments?.length ?? 0), 0),
    auditEventCount: Array.isArray(vault?.audit) ? vault.audit.length : 0,
    encryptedPayloadBytes: manifest?.encryptedPayloadBytes ?? null,
    encryptedAttachmentBytes: manifest?.encryptedAttachmentBytes ?? null,
    verifiedMeaning: "This file decrypted successfully. It does not prove the backup is current."
  };
}
