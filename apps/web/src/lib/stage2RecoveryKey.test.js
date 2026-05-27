import test from "node:test";
import assert from "node:assert/strict";
import {
  createStage1VaultRecord,
  decryptVaultWithPassphrase,
  decryptVaultWithRecoveryKey,
  generateRecoveryKey
} from "./stage1Crypto.js";
import {
  cancelRecoveryKeyReplacement,
  confirmRecoveryKeyReplacement,
  createRecoveryKeyMetadata,
  startRecoveryKeyReplacement
} from "./stage2RecoveryKey.js";

const passphrase = "correct horse battery staple";
const vault = {
  version: 1,
  items: [{ id: "record-1", title: "Private bank", secret: "Do not leak" }],
  releaseSettings: { mainNominee: "", keyHolders: [], emergencyOnly: true },
  audit: []
};

test("recovery key metadata never exposes the existing key", () => {
  const metadata = createRecoveryKeyMetadata({ confirmedAt: "2026-05-04T10:00:00.000Z" });

  assert.equal(metadata.status, "configured_confirmed");
  assert.equal(metadata.canViewExistingKey, false);
  assert.equal(metadata.canReplaceWhileUnlocked, true);
  assert.equal(JSON.stringify(metadata).includes("OS1A-"), false);
});

test("replacement is refused while locked", async () => {
  const started = startRecoveryKeyReplacement({ vaultKey: null });
  const confirmed = await confirmRecoveryKeyReplacement({
    encryptedRecord: null,
    vaultKey: null,
    newRecoveryKey: "OS1A-ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567",
    confirmation: "OS1A-ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567"
  });

  assert.equal(started.ok, false);
  assert.equal(started.code, "vault_locked");
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.code, "vault_locked");
});

test("new recovery key must be confirmed exactly", async () => {
  const oldRecoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({ vault, passphrase, recoveryKey: oldRecoveryKey });
  const unlocked = await decryptVaultWithPassphrase(record, passphrase);
  const started = startRecoveryKeyReplacement({ vaultKey: unlocked.vaultKey });

  const confirmed = await confirmRecoveryKeyReplacement({
    encryptedRecord: record,
    vaultKey: unlocked.vaultKey,
    newRecoveryKey: started.generatedRecoveryKey,
    confirmation: "wrong key"
  });

  assert.equal(started.ok, true);
  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.code, "confirmation_mismatch");
  await assert.doesNotReject(() => decryptVaultWithRecoveryKey(record, oldRecoveryKey));
});

test("cancelled replacement keeps old recovery key active and discards generated key", async () => {
  const oldRecoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({ vault, passphrase, recoveryKey: oldRecoveryKey });
  const unlocked = await decryptVaultWithPassphrase(record, passphrase);
  const started = startRecoveryKeyReplacement({ vaultKey: unlocked.vaultKey });
  const cancelled = cancelRecoveryKeyReplacement();

  assert.equal(started.ok, true);
  assert.equal(cancelled.state, "replacement_cancelled");
  assert.equal(cancelled.generatedRecoveryKey, null);
  await assert.doesNotReject(() => decryptVaultWithRecoveryKey(record, oldRecoveryKey));
});

test("confirmed replacement invalidates old recovery key and makes new key unlock", async () => {
  const oldRecoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({ vault, passphrase, recoveryKey: oldRecoveryKey });
  const unlocked = await decryptVaultWithPassphrase(record, passphrase);
  const started = startRecoveryKeyReplacement({ vaultKey: unlocked.vaultKey });

  const confirmed = await confirmRecoveryKeyReplacement({
    encryptedRecord: record,
    vaultKey: unlocked.vaultKey,
    newRecoveryKey: started.generatedRecoveryKey,
    confirmation: started.generatedRecoveryKey
  });

  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.auditEvent, "Recovery key replaced");
  assert.equal(confirmed.recommendFreshBackup, true);
  assert.equal(confirmed.recoveryKeyMetadata.canViewExistingKey, false);
  await assert.rejects(() => decryptVaultWithRecoveryKey(confirmed.record, oldRecoveryKey), /Could not unlock vault/);
  const reopened = await decryptVaultWithRecoveryKey(confirmed.record, started.generatedRecoveryKey);
  assert.deepEqual(reopened.vault, vault);
  assert.equal(confirmed.record.keyEnvelopes.passphrase.wrappedKey.ciphertext, record.keyEnvelopes.passphrase.wrappedKey.ciphertext);
  assert.notEqual(confirmed.record.keyEnvelopes.recovery.wrappedKey.ciphertext, record.keyEnvelopes.recovery.wrappedKey.ciphertext);
});

test("close-but-not-exact confirmation is refused", async () => {
  const oldRecoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({ vault, passphrase, recoveryKey: oldRecoveryKey });
  const unlocked = await decryptVaultWithPassphrase(record, passphrase);
  const started = startRecoveryKeyReplacement({ vaultKey: unlocked.vaultKey });

  // BIP39 phrases are already lowercase + space-separated, so "looking
  // normalized" isn't a mistake the user can make. The real mistake we
  // want to catch is a dropped or substituted word.
  const words = started.generatedRecoveryKey.split(/\s+/);
  const mutated = words.slice(0, -1).join(" "); // drop last word

  const confirmed = await confirmRecoveryKeyReplacement({
    encryptedRecord: record,
    vaultKey: unlocked.vaultKey,
    newRecoveryKey: started.generatedRecoveryKey,
    confirmation: mutated
  });

  assert.equal(confirmed.ok, false);
  assert.equal(confirmed.code, "confirmation_mismatch");
  await assert.doesNotReject(() => decryptVaultWithRecoveryKey(record, oldRecoveryKey));
});

test("lock during replacement discards generated replacement key", () => {
  const discarded = cancelRecoveryKeyReplacement({ reason: "locked" });

  assert.equal(discarded.state, "replacement_cancelled");
  assert.equal(discarded.reason, "locked");
  assert.equal(discarded.generatedRecoveryKey, null);
});
