import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_LOCK_MS,
  DEFAULT_AUTO_LOCK_MS,
  LOCK_TIMEOUT_OPTIONS,
  createPendingAuditEvent,
  drainPendingAuditEvents,
  formatLockReason,
  loadAutoLockPolicy,
  saveAutoLockPolicy,
  shouldAutoLockForActivity,
  shouldLockForVisibility
} from "./stage1Session.js";
import { createMemoryStorage } from "./stage1Store.js";

test("auto-lock triggers only after the inactivity window", () => {
  assert.equal(shouldAutoLockForActivity(1000, 1000 + AUTO_LOCK_MS - 1), false);
  assert.equal(shouldAutoLockForActivity(1000, 1000 + AUTO_LOCK_MS), true);
});

test("visibility lock triggers when document is hidden", () => {
  assert.equal(shouldLockForVisibility("hidden"), true);
  assert.equal(shouldLockForVisibility("visible"), false);
});

test("pending audit events are safe metadata and drain once", () => {
  const storage = createMemoryStorage();

  createPendingAuditEvent(storage, "Failed unlock attempt: wrong phrase DemoGmail#2026");
  const firstDrain = drainPendingAuditEvents(storage);
  const secondDrain = drainPendingAuditEvents(storage);

  assert.equal(firstDrain.length, 1);
  assert.equal(firstDrain[0].event, "Failed unlock attempt");
  assert.equal(secondDrain.length, 0);
});

test("auto-lock policy persists only allowed timeout values", () => {
  const storage = createMemoryStorage();

  assert.equal(loadAutoLockPolicy(storage), DEFAULT_AUTO_LOCK_MS);
  saveAutoLockPolicy(storage, LOCK_TIMEOUT_OPTIONS[2].ms);
  assert.equal(loadAutoLockPolicy(storage), LOCK_TIMEOUT_OPTIONS[2].ms);
  saveAutoLockPolicy(storage, 12345);
  assert.equal(loadAutoLockPolicy(storage), DEFAULT_AUTO_LOCK_MS);
});

test("formats lock reasons for one-time relock notice", () => {
  assert.equal(formatLockReason("Manual lock"), "Locked manually. Decrypted vault state was cleared from this session.");
  assert.equal(formatLockReason("Auto-lock after inactivity"), "Locked after inactivity. Decrypted vault state was cleared from this session.");
  assert.equal(formatLockReason("Auto-lock after app moved to background"), "Locked because the app moved to the background. Decrypted vault state was cleared from this session.");
});
