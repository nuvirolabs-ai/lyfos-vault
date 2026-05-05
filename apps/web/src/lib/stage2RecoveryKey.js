import { generateRecoveryKey, replaceRecoveryKeyEnvelope } from "./stage1Crypto.js";

export function createRecoveryKeyMetadata({ confirmedAt = new Date().toISOString(), lastReplacedAt = null } = {}) {
  return {
    status: "configured_confirmed",
    confirmedAt,
    lastReplacedAt,
    canViewExistingKey: false,
    canReplaceWhileUnlocked: true
  };
}

export function startRecoveryKeyReplacement({ vaultKey }) {
  if (!vaultKey) {
    return {
      ok: false,
      code: "vault_locked",
      reason: "Unlock the vault before replacing the recovery key."
    };
  }

  return {
    ok: true,
    state: "replacement_confirmation_required",
    generatedRecoveryKey: generateRecoveryKey(),
    message: "Confirm this new recovery key before OS-One replaces the old one."
  };
}

export async function confirmRecoveryKeyReplacement({ encryptedRecord, vaultKey, newRecoveryKey, confirmation }) {
  if (!encryptedRecord || !vaultKey) {
    return {
      ok: false,
      code: "vault_locked",
      reason: "Unlock the vault before replacing the recovery key."
    };
  }

  if (String(confirmation ?? "") !== String(newRecoveryKey ?? "")) {
    return {
      ok: false,
      code: "confirmation_mismatch",
      reason: "The confirmation does not match the new recovery key."
    };
  }

  const record = await replaceRecoveryKeyEnvelope(encryptedRecord, vaultKey, newRecoveryKey);
  return {
    ok: true,
    state: "replacement_complete",
    record,
    recoveryKeyMetadata: createRecoveryKeyMetadata({
      confirmedAt: new Date().toISOString(),
      lastReplacedAt: new Date().toISOString()
    }),
    auditEvent: "Recovery key replaced",
    recommendFreshBackup: true
  };
}

export function cancelRecoveryKeyReplacement({ reason = "cancelled" } = {}) {
  return {
    ok: true,
    state: "replacement_cancelled",
    reason,
    generatedRecoveryKey: null
  };
}
