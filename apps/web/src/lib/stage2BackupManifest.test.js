import test from "node:test";
import assert from "node:assert/strict";
import { createStage1VaultRecord, generateRecoveryKey } from "./stage1Crypto.js";
import {
  createStage2BackupManifest,
  getBackupFormatLabel,
  getEncryptedByteSize,
  isStage2BackupManifest,
  normalizeImportedBackup,
  prepareStage2BackupExport,
  validateStage2BackupManifest
} from "./stage2BackupManifest.js";

const passphrase = "correct horse battery staple";

const sensitiveVault = {
  version: 1,
  items: [
    {
      id: "item-1",
      title: "Primary HDFC Bank Account",
      category: "Money",
      type: "Bank account",
      institution: "HDFC Private Bank",
      notes: "Tell Neha before touching this account.",
      familyNotes: "The blue folder has the cheque book.",
      sensitiveValues: [
        { label: "Netbanking password", value: "Rupee Secret 9981" },
        { label: "Card PIN", value: "4411" }
      ],
      nominee: "Neha Saraswat",
      attachments: [
        {
          id: "attachment-1",
          name: "HDFC Statement April.pdf",
          filename: "HDFC Statement April.pdf",
          type: "application/pdf",
          dataUrl: "data:application/pdf;base64,JVBERi0xLjQ="
        }
      ]
    },
    {
      id: "item-2",
      title: "Passport and Aadhaar",
      category: "Identity",
      type: "ID document",
      notes: "Passport lives in the home locker.",
      attachments: []
    }
  ],
  releaseSettings: {
    mainNominee: "Neha Saraswat",
    keyHolders: ["Rohan Mehta", "Priya Kapoor"],
    emergencyOnly: true
  },
  audit: [
    { id: "audit-1", type: "record_created", at: "2026-05-04T09:00:00.000Z" },
    { id: "audit-2", type: "attachment_added", at: "2026-05-04T09:05:00.000Z" }
  ]
};

test("creates a Stage 2 backup manifest around an existing encrypted Stage 1 vault", async () => {
  const encryptedVaultContainer = await createStage1VaultRecord({
    vault: sensitiveVault,
    passphrase,
    recoveryKey: generateRecoveryKey()
  });

  const manifest = createStage2BackupManifest({
    encryptedVaultContainer,
    vaultSnapshot: sensitiveVault,
    exportedAt: "2026-05-04T10:00:00.000Z",
    appVersion: "stage2-release-test"
  });

  assert.equal(manifest.kind, "os-one-encrypted-backup");
  assert.equal(manifest.backupSchemaVersion, 2);
  assert.equal(manifest.exportedAt, "2026-05-04T10:00:00.000Z");
  assert.equal(manifest.createdByAppVersion, "stage2-release-test");
  assert.equal(manifest.recordCount, 2);
  assert.equal(manifest.attachmentCount, 1);
  assert.equal(manifest.auditEventCount, 2);
  assert.equal(manifest.kdfName, "argon2id");
  assert.equal(manifest.encryptedAttachmentBytes, 0);
  assert.ok(manifest.encryptedPayloadBytes > 0);
  assert.equal(manifest.encryptedVaultContainer, encryptedVaultContainer);
  assert.equal(isStage2BackupManifest(manifest), true);
  assert.deepEqual(validateStage2BackupManifest(manifest), { ok: true });
  assert.equal(getBackupFormatLabel(manifest), "Stage 2 encrypted backup manifest");
});

test("does not leak sensitive vault metadata into the plaintext manifest", async () => {
  const encryptedVaultContainer = await createStage1VaultRecord({
    vault: sensitiveVault,
    passphrase,
    recoveryKey: generateRecoveryKey()
  });

  const manifest = createStage2BackupManifest({
    encryptedVaultContainer,
    vaultSnapshot: sensitiveVault,
    exportedAt: "2026-05-04T10:00:00.000Z",
    appVersion: "stage2-release-test"
  });
  const plaintext = JSON.stringify({
    ...manifest,
    encryptedVaultContainer: "[encrypted container omitted from plaintext leak scan]"
  });

  for (const forbidden of [
    "Primary HDFC Bank Account",
    "Money",
    "Bank account",
    "HDFC Private Bank",
    "Tell Neha before touching this account.",
    "The blue folder has the cheque book.",
    "Netbanking password",
    "Rupee Secret 9981",
    "Card PIN",
    "4411",
    "Neha Saraswat",
    "HDFC Statement April.pdf",
    "Passport and Aadhaar",
    "Identity",
    "Passport lives in the home locker.",
    "Rohan Mehta",
    "Priya Kapoor"
  ]) {
    assert.equal(plaintext.includes(forbidden), false, `manifest leaked ${forbidden}`);
  }
});

test("rejects invalid Stage 2 manifests and unsupported versions", async () => {
  const encryptedVaultContainer = await createStage1VaultRecord({
    vault: sensitiveVault,
    passphrase,
    recoveryKey: generateRecoveryKey()
  });

  const manifest = createStage2BackupManifest({
    encryptedVaultContainer,
    vaultSnapshot: sensitiveVault
  });

  assert.equal(validateStage2BackupManifest({ ...manifest, encryptedVaultContainer: null }).ok, false);
  assert.match(validateStage2BackupManifest({ ...manifest, encryptedVaultContainer: null }).reason, /missing encrypted vault/i);
  assert.equal(validateStage2BackupManifest({ ...manifest, backupSchemaVersion: 999 }).ok, false);
  assert.match(validateStage2BackupManifest({ ...manifest, backupSchemaVersion: 999 }).reason, /unsupported/i);
});

test("normalizes Stage 2 manifests and direct Stage 1 backups to the encrypted vault container", async () => {
  const encryptedVaultContainer = await createStage1VaultRecord({
    vault: sensitiveVault,
    passphrase,
    recoveryKey: generateRecoveryKey()
  });
  const manifest = createStage2BackupManifest({
    encryptedVaultContainer,
    vaultSnapshot: sensitiveVault
  });

  assert.deepEqual(normalizeImportedBackup(manifest), {
    ok: true,
    record: encryptedVaultContainer,
    sourceFormat: "stage2-manifest",
    manifest
  });
  assert.deepEqual(normalizeImportedBackup(encryptedVaultContainer), {
    ok: true,
    record: encryptedVaultContainer,
    sourceFormat: "stage1-direct",
    manifest: null
  });
  assert.equal(getBackupFormatLabel(encryptedVaultContainer), "Stage 1 direct encrypted vault");
});

test("computes encrypted byte size from UTF-8 JSON serialization", () => {
  assert.equal(getEncryptedByteSize({ value: "abc" }), new TextEncoder().encode(JSON.stringify({ value: "abc" })).byteLength);
});

test("prepares an exported Stage 2 manifest instead of a direct Stage 1 backup", async () => {
  const encryptedVaultContainer = await createStage1VaultRecord({
    vault: sensitiveVault,
    passphrase,
    recoveryKey: generateRecoveryKey()
  });

  const exportPackage = prepareStage2BackupExport({
    encryptedVaultContainer,
    vaultSnapshot: sensitiveVault,
    exportedAt: "2026-05-04T11:00:00.000Z",
    appVersion: "stage2-release-test"
  });
  const parsed = JSON.parse(exportPackage.text);

  assert.equal(exportPackage.filename, "os-one-stage2-encrypted-vault-backup.json");
  assert.equal(parsed.kind, "os-one-encrypted-backup");
  assert.equal(parsed.backupSchemaVersion, 2);
  assert.deepEqual(normalizeImportedBackup(parsed), {
    ok: true,
    record: encryptedVaultContainer,
    sourceFormat: "stage2-manifest",
    manifest: parsed
  });
  assert.equal(exportPackage.manifest.backupId, parsed.backupId);
  assert.equal(exportPackage.encryptedPayloadBytes, getEncryptedByteSize(parsed));
});
