import test from "node:test";
import assert from "node:assert/strict";
import {
  getBackupReminderCopy,
  getBackupReminderLevel,
  isBackupStale
} from "./stage2BackupReminders.js";

test("backup becomes stale when vault update is more than 24 hours after verified backup", () => {
  assert.equal(isBackupStale({
    currentVaultUpdatedAt: "2026-05-05T10:00:01.000Z",
    lastVerifiedVaultUpdatedAt: "2026-05-04T10:00:00.000Z"
  }), true);

  assert.equal(isBackupStale({
    currentVaultUpdatedAt: "2026-05-05T09:59:59.000Z",
    lastVerifiedVaultUpdatedAt: "2026-05-04T10:00:00.000Z"
  }), false);
});

test("backup becomes stale for explicit record, attachment, and recovery key changes", () => {
  for (const reason of ["record_change", "attachment_change", "recovery_key_replaced"]) {
    assert.equal(isBackupStale({
      currentVaultUpdatedAt: "2026-05-04T10:01:00.000Z",
      lastVerifiedVaultUpdatedAt: "2026-05-04T10:00:00.000Z",
      lastVaultChangeReason: reason
    }), true, reason);
  }
});

test("reminder levels come only from backup health state", () => {
  assert.equal(getBackupReminderLevel({ status: "missing" }), "none");
  assert.equal(getBackupReminderLevel({ status: "verified_current" }), "none");
  assert.equal(getBackupReminderLevel({ status: "verified_stale" }), "stale");
  assert.equal(getBackupReminderLevel({ status: "exported_unverified" }), "verify");
  assert.equal(getBackupReminderLevel({ status: "verification_failed" }), "failed");
});

test("stale reminder copy is calm local and has one primary action", () => {
  const copy = getBackupReminderCopy({
    status: "verified_stale",
    lastVaultChangeReason: "attachment_change"
  });

  assert.equal(copy.primaryAction, "Export fresh backup");
  assert.match(copy.body, /not current/i);
  assert.match(copy.body, /attachment/i);

  const serialized = JSON.stringify(copy).toLowerCase();
  for (const forbidden of ["cloud", "sync", "email", "push", "notification", "server", "broken", "unusable"]) {
    assert.equal(serialized.includes(forbidden), false, `copy used forbidden word ${forbidden}`);
  }
});

test("non-stale reminder copy stays non-alarming", () => {
  assert.equal(getBackupReminderCopy({ status: "verified_current" }).primaryAction, null);
  assert.equal(getBackupReminderCopy({ status: "missing" }).level, "none");
});
