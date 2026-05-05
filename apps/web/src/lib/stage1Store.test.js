import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultBackupHealth } from "./stage2BackupHealth.js";
import {
  BACKUP_HEALTH_STORAGE_KEY,
  createMemoryStorage,
  clearStage1Record,
  loadBackupHealth,
  loadStage1Record,
  saveBackupHealth,
  saveStage1Record,
  restoreStage1Backup,
  STAGE1_STORAGE_KEY
} from "./stage1Store.js";
import { createStage2BackupManifest } from "./stage2BackupManifest.js";

const validRecord = {
  kind: "os-one-stage1-vault",
  version: 2,
  updatedAt: "2026-05-03T00:00:00.000Z",
  plaintextNotice: { accountLoginDecryptsVault: false },
  keyEnvelopes: { passphrase: { wrappedKey: { ciphertext: "encrypted-key" } } },
  encryptedVault: { ciphertext: "encrypted-vault" }
};

test("saves and loads the Stage 1 vault record from the configured storage key", () => {
  const storage = createMemoryStorage();

  saveStage1Record(storage, validRecord);

  assert.equal(storage.getItem(STAGE1_STORAGE_KEY), JSON.stringify(validRecord));
  assert.deepEqual(loadStage1Record(storage), validRecord);
});

test("returns null for empty or malformed local state", () => {
  const storage = createMemoryStorage();

  assert.equal(loadStage1Record(storage), null);

  storage.setItem(STAGE1_STORAGE_KEY, "{broken");
  assert.equal(loadStage1Record(storage), null);
});

test("persists backup health metadata separately from the encrypted vault", () => {
  const storage = createMemoryStorage();
  const health = {
    ...createDefaultBackupHealth(),
    status: "exported_unverified",
    lastExportedAt: "2026-05-04T10:00:00.000Z"
  };

  saveBackupHealth(storage, health);

  assert.equal(storage.getItem(BACKUP_HEALTH_STORAGE_KEY), JSON.stringify(health));
  assert.deepEqual(loadBackupHealth(storage), health);
  assert.equal(loadStage1Record(storage), null);
});

test("clearing local vault also clears backup health metadata", () => {
  const storage = createMemoryStorage();
  saveStage1Record(storage, validRecord);
  saveBackupHealth(storage, { ...createDefaultBackupHealth(), status: "verification_failed" });

  clearStage1Record(storage);

  assert.equal(loadStage1Record(storage), null);
  assert.deepEqual(loadBackupHealth(storage), createDefaultBackupHealth());
});

test("restore validates backup JSON before replacing local state", () => {
  const storage = createMemoryStorage();

  const restored = restoreStage1Backup(storage, JSON.stringify(validRecord));

  assert.deepEqual(restored, { ok: true, record: validRecord });
  assert.deepEqual(loadStage1Record(storage), validRecord);
});

test("restore accepts Stage 2 backup manifests while storing only the encrypted vault container", () => {
  const storage = createMemoryStorage();
  const manifest = createStage2BackupManifest({
    encryptedVaultContainer: validRecord,
    vaultSnapshot: {
      items: [{ title: "Do not leak this title", category: "Money", attachments: [{ name: "Do not leak.pdf" }] }],
      audit: [{ type: "backup_exported" }]
    }
  });

  const restored = restoreStage1Backup(storage, JSON.stringify(manifest));

  assert.deepEqual(restored, { ok: true, record: validRecord });
  assert.deepEqual(loadStage1Record(storage), validRecord);
});

test("restore refuses invalid backup and keeps previous local state", () => {
  const storage = createMemoryStorage();
  saveStage1Record(storage, validRecord);

  const restored = restoreStage1Backup(storage, JSON.stringify({ version: 2 }));

  assert.equal(restored.ok, false);
  assert.match(restored.reason, /not an OS-One Stage 1 backup/i);
  assert.deepEqual(loadStage1Record(storage), validRecord);
});
