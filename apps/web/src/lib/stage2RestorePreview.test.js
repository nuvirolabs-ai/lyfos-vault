import test from "node:test";
import assert from "node:assert/strict";
import { createStage1VaultRecord, generateRecoveryKey } from "./stage1Crypto.js";
import { createMemoryStorage, loadStage1Record, saveStage1Record } from "./stage1Store.js";
import { createStage2BackupManifest } from "./stage2BackupManifest.js";
import {
  canConfirmDestructiveRestore,
  compareRestoreImpact,
  createRestoreDryRun,
  getRestoreImpactCopy
} from "./stage2RestorePreview.js";

const passphrase = "correct horse battery staple";

const incomingVault = {
  version: 1,
  items: [
    {
      id: "incoming-1",
      title: "Private HDFC account",
      category: "Money",
      notes: "Do not show this note",
      attachments: [{ id: "a1", name: "Bank statement.pdf", type: "application/pdf" }]
    },
    { id: "incoming-2", title: "Passport", category: "Identity", attachments: [] }
  ],
  releaseSettings: { mainNominee: "Neha", keyHolders: [], emergencyOnly: true },
  audit: [{ id: "audit-1", event: "Vault created", at: "2026-05-04T08:00:00.000Z" }]
};

const currentVault = {
  version: 1,
  items: [{ id: "current-1", title: "Current record", category: "Access", attachments: [] }],
  releaseSettings: { mainNominee: "", keyHolders: [], emergencyOnly: true },
  audit: []
};

test("practice preview decrypts a Stage 2 manifest without replacing local vault state", async () => {
  const storage = createMemoryStorage();
  const currentRecord = await createStage1VaultRecord({ vault: currentVault, passphrase, recoveryKey: generateRecoveryKey() });
  const incomingRecord = await createStage1VaultRecord({ vault: incomingVault, passphrase, recoveryKey: generateRecoveryKey() });
  const manifest = createStage2BackupManifest({ encryptedVaultContainer: incomingRecord, vaultSnapshot: incomingVault });
  saveStage1Record(storage, currentRecord);

  const preview = await createRestoreDryRun({
    backupText: JSON.stringify(manifest),
    secret: passphrase,
    mode: "passphrase",
    currentRecord
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.sourceFormat, "stage2-manifest");
  assert.equal(preview.impact.incoming.recordCount, 2);
  assert.equal(preview.impact.current.recordCount, 1);
  assert.equal(preview.impact.willReplaceCurrent, true);
  assert.deepEqual(loadStage1Record(storage), currentRecord);
});

test("practice preview decrypts a Stage 1 direct backup", async () => {
  const incomingRecord = await createStage1VaultRecord({ vault: incomingVault, passphrase, recoveryKey: generateRecoveryKey() });

  const preview = await createRestoreDryRun({
    backupText: JSON.stringify(incomingRecord),
    secret: passphrase,
    mode: "passphrase"
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.sourceFormat, "stage1-direct");
  assert.equal(preview.impact.incoming.recordCount, 2);
  assert.equal(preview.impact.current, null);
});

test("restore impact reports older newer same-era and unknown", () => {
  assert.equal(compareRestoreImpact({
    incomingMetadata: { updatedAt: "2026-05-04T11:00:00.000Z" },
    currentMetadata: { updatedAt: "2026-05-04T10:00:00.000Z" }
  }).era, "newer");
  assert.equal(compareRestoreImpact({
    incomingMetadata: { updatedAt: "2026-05-04T09:00:00.000Z" },
    currentMetadata: { updatedAt: "2026-05-04T10:00:00.000Z" }
  }).era, "older");
  assert.equal(compareRestoreImpact({
    incomingMetadata: { updatedAt: "2026-05-04T10:00:20.000Z" },
    currentMetadata: { updatedAt: "2026-05-04T10:00:00.000Z" }
  }).era, "same-era");
  assert.equal(compareRestoreImpact({
    incomingMetadata: { updatedAt: null },
    currentMetadata: { updatedAt: "2026-05-04T10:00:00.000Z" }
  }).era, "unknown");
});

test("impact copy is calm, explicit, and secret-free", () => {
  const copy = getRestoreImpactCopy({
    era: "older",
    incoming: { recordCount: 2, attachmentCount: 1, auditEventCount: 1 },
    current: { recordCount: 1, attachmentCount: 0, auditEventCount: 0 },
    willReplaceCurrent: true,
    title: "Private HDFC account",
    attachmentName: "Bank statement.pdf",
    nominee: "Neha"
  });

  assert.match(copy.summary, /older/i);
  assert.match(copy.destructiveWarning, /replace/i);
  assert.equal(copy.requiredConfirmation, "REPLACE LOCAL VAULT");
  for (const forbidden of ["Private HDFC account", "Bank statement.pdf", "Neha"]) {
    assert.equal(JSON.stringify(copy).includes(forbidden), false, `impact copy leaked ${forbidden}`);
  }
});

test("destructive replace requires exact typed confirmation", () => {
  assert.equal(canConfirmDestructiveRestore("REPLACE"), false);
  assert.equal(canConfirmDestructiveRestore("replace local vault"), false);
  assert.equal(canConfirmDestructiveRestore("REPLACE LOCAL VAULT "), false);
  assert.equal(canConfirmDestructiveRestore("REPLACE LOCAL VAULT"), true);
});

test("invalid backup shape returns a preview failure", async () => {
  const preview = await createRestoreDryRun({
    backupText: JSON.stringify({ version: 2 }),
    secret: passphrase,
    mode: "passphrase"
  });

  assert.equal(preview.ok, false);
  assert.equal(preview.code, "invalid_shape");
});
