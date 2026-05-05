import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_SIZE_STRONG_THRESHOLD_BYTES,
  BACKUP_SIZE_SOFT_THRESHOLD_BYTES,
  formatBackupSize,
  getBackupSizeWarning
} from "./stage2BackupSize.js";

test("returns no warning below the 20 MB encrypted-size threshold", () => {
  const warning = getBackupSizeWarning({
    encryptedPayloadBytes: BACKUP_SIZE_SOFT_THRESHOLD_BYTES - 1,
    encryptedAttachmentBytes: 0
  });

  assert.equal(warning.level, "none");
  assert.equal(warning.totalBytes, BACKUP_SIZE_SOFT_THRESHOLD_BYTES - 1);
  assert.equal(warning.copy, "");
});

test("returns a soft warning at 20 MB and above", () => {
  const warning = getBackupSizeWarning({
    encryptedPayloadBytes: BACKUP_SIZE_SOFT_THRESHOLD_BYTES,
    encryptedAttachmentBytes: 0
  });

  assert.equal(warning.level, "soft");
  assert.equal(warning.totalBytes, BACKUP_SIZE_SOFT_THRESHOLD_BYTES);
  assert.match(warning.copy, /may take longer/i);
  assert.match(warning.copy, /move or store/i);
});

test("returns a strong warning at 100 MB and above", () => {
  const warning = getBackupSizeWarning({
    encryptedPayloadBytes: BACKUP_SIZE_STRONG_THRESHOLD_BYTES - 1,
    encryptedAttachmentBytes: 1
  });

  assert.equal(warning.level, "strong");
  assert.equal(warning.totalBytes, BACKUP_SIZE_STRONG_THRESHOLD_BYTES);
  assert.match(warning.copy, /large encrypted backup/i);
  assert.match(warning.copy, /more time and storage/i);
});

test("uses only encrypted payload and attachment byte counts", () => {
  const warning = getBackupSizeWarning({
    encryptedPayloadBytes: 12 * 1024 * 1024,
    encryptedAttachmentBytes: 9 * 1024 * 1024,
    attachmentNames: ["HDFC Statement April.pdf"],
    categories: ["Money"],
    fileTypes: ["application/pdf"]
  });

  assert.equal(warning.level, "soft");
  assert.equal(warning.totalBytes, 21 * 1024 * 1024);
});

test("warning copy does not expose content hints or suggest cloud behavior", () => {
  const warning = getBackupSizeWarning({
    encryptedPayloadBytes: BACKUP_SIZE_STRONG_THRESHOLD_BYTES,
    encryptedAttachmentBytes: 0
  });
  const copy = warning.copy.toLowerCase();

  for (const forbidden of [
    "hdfc",
    "statement",
    "pdf",
    "image",
    "money",
    "identity",
    "google drive",
    "dropbox",
    "icloud",
    "cloud",
    "sync",
    "upload",
    "less encrypted",
    "security failure"
  ]) {
    assert.equal(copy.includes(forbidden), false, `copy included ${forbidden}`);
  }
});

test("formats encrypted byte sizes for readable backup copy", () => {
  assert.equal(formatBackupSize(0), "0 B");
  assert.equal(formatBackupSize(512), "512 B");
  assert.equal(formatBackupSize(1024), "1 KB");
  assert.equal(formatBackupSize(1536), "1.5 KB");
  assert.equal(formatBackupSize(20 * 1024 * 1024), "20 MB");
  assert.equal(formatBackupSize(100.25 * 1024 * 1024), "100.3 MB");
});
