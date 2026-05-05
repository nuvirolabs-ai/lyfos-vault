import test from "node:test";
import assert from "node:assert/strict";
import { createStage1VaultRecord, generateRecoveryKey } from "./stage1Crypto.js";
import { compareBackupEra, createRestorePreview } from "./stage1Store.js";

const vault = {
  version: 1,
  items: [
    { id: "1", title: "Bank", attachments: [{ id: "a1" }, { id: "a2" }] },
    { id: "2", title: "Passport", attachments: [] }
  ],
  releaseSettings: { mainNominee: "", keyHolders: ["", "", "", "", ""], emergencyOnly: true },
  audit: [{ id: "e1", event: "Vault created", at: "2026-05-03T00:00:00.000Z" }]
};

test("restore preview decrypts backup metadata before local replacement", async () => {
  const recoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({
    vault,
    passphrase: "correct horse battery staple",
    recoveryKey
  });

  const preview = await createRestorePreview({
    backupText: JSON.stringify(record),
    secret: "correct horse battery staple",
    mode: "passphrase"
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.metadata.formatVersion, 2);
  assert.equal(preview.metadata.recordCount, 2);
  assert.equal(preview.metadata.attachmentCount, 2);
  assert.equal(preview.metadata.auditEventCount, 1);
  assert.equal(preview.record.kind, "os-one-stage1-vault");
});

test("restore preview compares incoming backup against current local vault when secret matches", async () => {
  const recoveryKey = generateRecoveryKey();
  const currentRecord = await createStage1VaultRecord({
    vault: { ...vault, items: vault.items.slice(0, 1), audit: [] },
    passphrase: "correct horse battery staple",
    recoveryKey
  });
  const incomingRecord = await createStage1VaultRecord({
    vault,
    passphrase: "correct horse battery staple",
    recoveryKey
  });
  incomingRecord.updatedAt = new Date(Date.now() + 60000).toISOString();
  currentRecord.updatedAt = new Date(Date.now() - 60000).toISOString();

  const preview = await createRestorePreview({
    backupText: JSON.stringify(incomingRecord),
    secret: "correct horse battery staple",
    mode: "passphrase",
    currentRecord
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.comparison.era, "newer");
  assert.equal(preview.comparison.current.recordCount, 1);
  assert.equal(preview.comparison.incoming.recordCount, 2);
  assert.equal(preview.comparison.currentPreviewed, true);
});

test("restore preview refuses invalid shape before decrypting", async () => {
  const preview = await createRestorePreview({
    backupText: JSON.stringify({ version: 2 }),
    secret: "correct horse battery staple",
    mode: "passphrase"
  });

  assert.equal(preview.ok, false);
  assert.match(preview.reason, /not an OS-One Stage 1 backup/i);
});

test("restore preview refuses wrong phrase without returning decrypted vault", async () => {
  const recoveryKey = generateRecoveryKey();
  const record = await createStage1VaultRecord({
    vault,
    passphrase: "correct horse battery staple",
    recoveryKey
  });

  const preview = await createRestorePreview({
    backupText: JSON.stringify(record),
    secret: "wrong phrase",
    mode: "passphrase"
  });

  assert.equal(preview.ok, false);
  assert.equal(preview.vault, undefined);
});

test("backup era comparison has older newer and same-era states", () => {
  const now = Date.now();

  assert.equal(compareBackupEra(new Date(now + 120000).toISOString(), new Date(now).toISOString()), "newer");
  assert.equal(compareBackupEra(new Date(now - 120000).toISOString(), new Date(now).toISOString()), "older");
  assert.equal(compareBackupEra(new Date(now + 10000).toISOString(), new Date(now).toISOString()), "same-era");
});
