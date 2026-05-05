import test from "node:test";
import assert from "node:assert/strict";
import {
  createStage1VaultRecord,
  decryptVaultWithPassphrase,
  decryptVaultWithRecoveryKey,
  generateRecoveryKey,
  normalizeRecoveryKey,
  replaceRecoveryKeyEnvelope,
  updateEncryptedVault,
  validateBackupRecord
} from "./stage1Crypto.js";

const sampleVault = {
  version: 1,
  items: [{ id: "record-1", title: "Primary bank", secret: "demo-secret" }],
  releaseSettings: { mainNominee: "", keyHolders: ["", "", "", "", ""], emergencyOnly: true },
  audit: []
};

test("creates a vault record that unlocks with passphrase but not the account alone", async () => {
  const recoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({
    vault: sampleVault,
    passphrase: "correct horse battery staple",
    recoveryKey
  });

  assert.equal(record.kind, "os-one-stage1-vault");
  assert.equal(record.version, 2);
  assert.equal(record.encryptedVault.algorithm, "AES-GCM");
  assert.ok(record.keyEnvelopes.passphrase);
  assert.ok(record.keyEnvelopes.recovery);
  assert.equal(record.plaintextNotice.accountLoginDecryptsVault, false);

  const unlocked = await decryptVaultWithPassphrase(record, "correct horse battery staple");
  assert.deepEqual(unlocked.vault, sampleVault);

  await assert.rejects(
    () => decryptVaultWithPassphrase(record, "wrong passphrase"),
    /Could not unlock vault/
  );
});

test("recovery key unwraps the same vault without server escrow", async () => {
  const recoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({
    vault: sampleVault,
    passphrase: "correct horse battery staple",
    recoveryKey
  });

  const unlocked = await decryptVaultWithRecoveryKey(record, recoveryKey.toLowerCase());

  assert.deepEqual(unlocked.vault, sampleVault);
  assert.equal(unlocked.usedEnvelope, "recovery");
});

test("updates encrypted vault without rotating key envelopes", async () => {
  const recoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({
    vault: sampleVault,
    passphrase: "correct horse battery staple",
    recoveryKey
  });
  const unlocked = await decryptVaultWithPassphrase(record, "correct horse battery staple");
  const nextVault = { ...sampleVault, items: [...sampleVault.items, { id: "record-2", title: "Passport" }] };

  const updated = await updateEncryptedVault(record, unlocked.vaultKey, nextVault);
  const reopened = await decryptVaultWithRecoveryKey(updated, recoveryKey);

  assert.deepEqual(reopened.vault, nextVault);
  assert.equal(updated.keyEnvelopes.passphrase.wrappedKey.ciphertext, record.keyEnvelopes.passphrase.wrappedKey.ciphertext);
  assert.notEqual(updated.encryptedVault.ciphertext, record.encryptedVault.ciphertext);
});

test("replaces only the recovery key envelope", async () => {
  const oldRecoveryKey = generateRecoveryKey();
  const newRecoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({
    vault: sampleVault,
    passphrase: "correct horse battery staple",
    recoveryKey: oldRecoveryKey
  });
  const unlocked = await decryptVaultWithPassphrase(record, "correct horse battery staple");

  const updated = await replaceRecoveryKeyEnvelope(record, unlocked.vaultKey, newRecoveryKey);

  await assert.rejects(() => decryptVaultWithRecoveryKey(updated, oldRecoveryKey), /Could not unlock vault/);
  await assert.doesNotReject(() => decryptVaultWithRecoveryKey(updated, newRecoveryKey));
  assert.equal(updated.keyEnvelopes.passphrase.wrappedKey.ciphertext, record.keyEnvelopes.passphrase.wrappedKey.ciphertext);
  assert.equal(updated.encryptedVault.ciphertext, record.encryptedVault.ciphertext);
  assert.notEqual(updated.keyEnvelopes.recovery.wrappedKey.ciphertext, record.keyEnvelopes.recovery.wrappedKey.ciphertext);
});

test("validates backup record shape before restore replaces local state", async () => {
  const recoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({
    vault: sampleVault,
    passphrase: "correct horse battery staple",
    recoveryKey
  });

  assert.equal(validateBackupRecord(record).ok, true);
  assert.equal(validateBackupRecord({ version: 2 }).ok, false);
  assert.match(validateBackupRecord({ version: 2 }).reason, /not an OS-One Stage 1 backup/i);
});

test("normalizes recovery keys while preserving exact entropy groups", () => {
  const key = "OS1A-ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567";

  assert.equal(normalizeRecoveryKey(key.toLowerCase().replaceAll("-", " ")), key);
});
