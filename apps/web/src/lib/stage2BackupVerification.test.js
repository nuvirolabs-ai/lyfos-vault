import test from "node:test";
import assert from "node:assert/strict";
import { createStage1VaultRecord, generateRecoveryKey } from "./stage1Crypto.js";
import { createMemoryStorage, loadStage1Record, saveStage1Record } from "./stage1Store.js";
import { createStage2BackupManifest } from "./stage2BackupManifest.js";
import { classifyBackupVerificationError, verifyBackup } from "./stage2BackupVerification.js";

const passphrase = "correct horse battery staple";

const vault = {
  version: 1,
  items: [
    {
      id: "record-1",
      title: "Private HDFC account",
      category: "Money",
      notes: "Do not expose this note",
      sensitiveValues: [{ label: "Password", value: "Secret#2026" }],
      attachments: [{ id: "a1", name: "Bank statement.pdf", type: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERi0x" }]
    }
  ],
  releaseSettings: { mainNominee: "Neha", keyHolders: ["Rohan"], emergencyOnly: true },
  audit: [
    { id: "audit-1", event: "Vault created", at: "2026-05-04T08:00:00.000Z" }
  ]
};

test("verifies a Stage 2 manifest backup with the vault phrase without exposing decrypted names", async () => {
  const record = await createStage1VaultRecord({ vault, passphrase, recoveryKey: generateRecoveryKey() });
  const manifest = createStage2BackupManifest({
    encryptedVaultContainer: record,
    vaultSnapshot: vault,
    exportedAt: "2026-05-04T10:00:00.000Z",
    appVersion: "stage2-beta-test"
  });

  const result = await verifyBackup({
    backupText: JSON.stringify(manifest),
    secret: passphrase,
    mode: "passphrase"
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceFormat, "stage2-manifest");
  assert.equal(result.formatLabel, "Stage 2 encrypted backup manifest");
  assert.equal(result.metadata.backupSchemaVersion, 2);
  assert.equal(result.metadata.formatVersion, 2);
  assert.equal(result.metadata.recordCount, 1);
  assert.equal(result.metadata.attachmentCount, 1);
  assert.equal(result.metadata.auditEventCount, 1);
  assert.equal(result.metadata.exportedAt, "2026-05-04T10:00:00.000Z");
  assert.equal(result.metadata.verifiedMeaning, "This file decrypted successfully. It does not prove the backup is current.");

  const serializedResult = JSON.stringify(result);
  for (const forbidden of ["Private HDFC account", "Money", "Do not expose this note", "Password", "Secret#2026", "Bank statement.pdf", "Neha", "Rohan"]) {
    assert.equal(serializedResult.includes(forbidden), false, `verification result leaked ${forbidden}`);
  }
});

test("verifies a Stage 2 manifest backup with the recovery key", async () => {
  const recoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({ vault, passphrase, recoveryKey });
  const manifest = createStage2BackupManifest({ encryptedVaultContainer: record, vaultSnapshot: vault });

  const result = await verifyBackup({
    backupText: JSON.stringify(manifest),
    secret: recoveryKey.toLowerCase(),
    mode: "recovery"
  });

  assert.equal(result.ok, true);
  assert.equal(result.usedEnvelope, "recovery");
  assert.equal(result.metadata.recordCount, 1);
});

test("verifies a direct Stage 1 backup with the vault phrase", async () => {
  const record = await createStage1VaultRecord({ vault, passphrase, recoveryKey: generateRecoveryKey() });

  const result = await verifyBackup({
    backupText: JSON.stringify(record),
    secret: passphrase,
    mode: "passphrase"
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceFormat, "stage1-direct");
  assert.equal(result.formatLabel, "Stage 1 direct encrypted vault");
  assert.equal(result.metadata.backupSchemaVersion, null);
  assert.equal(result.metadata.recordCount, 1);
});

test("classifies wrong secret without returning decrypted preview data", async () => {
  const record = await createStage1VaultRecord({ vault, passphrase, recoveryKey: generateRecoveryKey() });

  const result = await verifyBackup({
    backupText: JSON.stringify(record),
    secret: "wrong horse battery staple",
    mode: "passphrase"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "wrong_secret");
  assert.match(result.reason, /phrase or recovery key/i);
  assert.equal("metadata" in result, false);
});

test("classifies invalid shape and unsupported Stage 2 version cleanly", async () => {
  const invalid = await verifyBackup({
    backupText: JSON.stringify({ version: 2 }),
    secret: passphrase,
    mode: "passphrase"
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "invalid_shape");

  const record = await createStage1VaultRecord({ vault, passphrase, recoveryKey: generateRecoveryKey() });
  const manifest = createStage2BackupManifest({ encryptedVaultContainer: record, vaultSnapshot: vault });
  const unsupported = await verifyBackup({
    backupText: JSON.stringify({ ...manifest, backupSchemaVersion: 99 }),
    secret: passphrase,
    mode: "passphrase"
  });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.code, "unsupported_version");
});

test("classifies corrupted encrypted payload cleanly", async () => {
  const record = await createStage1VaultRecord({ vault, passphrase, recoveryKey: generateRecoveryKey() });
  const corrupted = {
    ...record,
    encryptedVault: {
      ...record.encryptedVault,
      ciphertext: "@@@not-base64@@@"
    }
  };

  const result = await verifyBackup({
    backupText: JSON.stringify(corrupted),
    secret: passphrase,
    mode: "passphrase"
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "corrupted_payload");
});

test("verification never replaces local vault state", async () => {
  const storage = createMemoryStorage();
  const currentRecord = await createStage1VaultRecord({
    vault: { ...vault, items: [] },
    passphrase,
    recoveryKey: generateRecoveryKey()
  });
  const importedRecord = await createStage1VaultRecord({ vault, passphrase, recoveryKey: generateRecoveryKey() });
  saveStage1Record(storage, currentRecord);

  const result = await verifyBackup({
    backupText: JSON.stringify(importedRecord),
    secret: passphrase,
    mode: "passphrase"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(loadStage1Record(storage), currentRecord);
});

test("classifies malformed JSON as invalid shape", () => {
  assert.deepEqual(classifyBackupVerificationError(new SyntaxError("bad json")), {
    code: "invalid_shape",
    reason: "Backup file is not valid JSON."
  });
});
