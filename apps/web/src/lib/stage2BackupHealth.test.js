import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultBackupHealth,
  deriveBackupHealth,
  getBackupHealthCopy,
  markBackupExported,
  markBackupUnknownAfterRestore,
  markBackupVerificationFailed,
  markBackupVerified
} from "./stage2BackupHealth.js";

const baseHealth = createDefaultBackupHealth();

test("default backup health is missing", () => {
  const health = createDefaultBackupHealth();

  assert.equal(health.status, "missing");
  assert.equal(health.lastExportedAt, null);
  assert.equal(getBackupHealthCopy(health).primaryAction, "Export encrypted backup");
});

test("export moves backup health to exported unverified without claiming safety", () => {
  const health = markBackupExported({
    health: baseHealth,
    manifest: {
      backupId: "backup-1",
      exportedAt: "2026-05-04T10:00:00.000Z",
      encryptedPayloadBytes: 1200
    }
  });

  assert.equal(health.status, "exported_unverified");
  assert.equal(health.lastExportedAt, "2026-05-04T10:00:00.000Z");
  assert.equal(health.lastKnownEncryptedPayloadBytes, 1200);
  assert.equal(getBackupHealthCopy(health).primaryAction, "Verify backup");
  assert.match(getBackupHealthCopy(health).body, /not verified/i);
});

test("successful verification moves backup health to verified current", () => {
  const health = markBackupVerified({
    health: markBackupExported({ health: baseHealth, manifest: { backupId: "backup-1", exportedAt: "2026-05-04T10:00:00.000Z" } }),
    verificationResult: {
      ok: true,
      metadata: {
        sourceExportedAt: "2026-05-04T10:00:00.000Z",
        recordCount: 2,
        attachmentCount: 1,
        encryptedPayloadBytes: 1300
      }
    },
    currentVault: { updatedAt: "2026-05-04T10:00:00.000Z" },
    now: "2026-05-04T10:05:00.000Z"
  });

  assert.equal(health.status, "verified_current");
  assert.equal(health.lastVerifiedAt, "2026-05-04T10:05:00.000Z");
  assert.equal(health.lastVerifiedVaultUpdatedAt, "2026-05-04T10:00:00.000Z");
  assert.equal(health.lastVerifiedRecordCount, 2);
  assert.equal(health.lastVerifiedAttachmentCount, 1);
  assert.equal(getBackupHealthCopy(health).primaryAction, "Preview backup");
  assert.match(getBackupHealthCopy(health).body, /not permanent/i);
});

test("verification failure moves backup health to verification failed", () => {
  const health = markBackupVerificationFailed({
    health: baseHealth,
    reason: "wrong_secret",
    now: "2026-05-04T10:10:00.000Z"
  });

  assert.equal(health.status, "verification_failed");
  assert.equal(health.lastVerificationFailureReason, "wrong_secret");
  assert.equal(getBackupHealthCopy(health).primaryAction, "Try another file");
});

test("vault change after verification derives stale state", () => {
  const verified = markBackupVerified({
    health: baseHealth,
    verificationResult: { ok: true, metadata: { recordCount: 1, attachmentCount: 0, encryptedPayloadBytes: 1000 } },
    currentVault: { updatedAt: "2026-05-04T10:00:00.000Z" },
    now: "2026-05-04T10:02:00.000Z"
  });

  const health = deriveBackupHealth({
    storedHealth: verified,
    currentVault: { updatedAt: "2026-05-04T10:03:00.000Z" }
  });

  assert.equal(health.status, "verified_stale");
  assert.equal(health.lastVaultChangeReason, "vault_changed");
  assert.equal(getBackupHealthCopy(health).primaryAction, "Export fresh backup");
});

test("record attachment and recovery key changes after verification derive stale with reason", () => {
  const verified = markBackupVerified({
    health: baseHealth,
    verificationResult: { ok: true, metadata: { recordCount: 1, attachmentCount: 0, encryptedPayloadBytes: 1000 } },
    currentVault: { updatedAt: "2026-05-04T10:00:00.000Z" },
    now: "2026-05-04T10:02:00.000Z"
  });

  for (const reason of ["record_change", "attachment_change", "recovery_key_replaced"]) {
    const health = deriveBackupHealth({
      storedHealth: verified,
      currentVault: { updatedAt: "2026-05-04T10:01:00.000Z" },
      changeReason: reason
    });
    assert.equal(health.status, "verified_stale");
    assert.equal(health.lastVaultChangeReason, reason);
  }
});

test("restore with unknown provenance can move health to unknown after restore", () => {
  const health = markBackupUnknownAfterRestore({
    health: baseHealth,
    now: "2026-05-04T10:30:00.000Z"
  });

  assert.equal(health.status, "unknown_after_restore");
  assert.equal(health.lastExportedAt, null);
  assert.equal(getBackupHealthCopy(health).primaryAction, "Verify backup");
});

test("backup health copy does not expose sensitive vault metadata", () => {
  const health = {
    ...createDefaultBackupHealth(),
    status: "verified_current",
    recordTitle: "Private HDFC account",
    attachmentName: "Bank statement.pdf",
    nominee: "Neha",
    secret: "Secret#2026"
  };

  const copy = JSON.stringify(getBackupHealthCopy(health));

  for (const forbidden of ["Private HDFC account", "Bank statement.pdf", "Neha", "Secret#2026"]) {
    assert.equal(copy.includes(forbidden), false, `health copy leaked ${forbidden}`);
  }
});
