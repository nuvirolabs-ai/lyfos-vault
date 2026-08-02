import test from "node:test";
import assert from "node:assert/strict";

import {
  CATALOGUE_VERSION,
  DIGITAL_LEGACY_SCHEMA_VERSION,
  SCORE_SPEC_VERSION,
  createDigitalLegacy,
  createLegacyRecord,
  deriveRecordStatus,
  resolveReleaseIntent,
  validateLegacyRecord
} from "./index.js";

const NOW = "2026-08-02T10:00:00.000Z";

function makeRecord(overrides = {}, options = {}) {
  return createLegacyRecord({
    categoryId: "banking-payments",
    serviceTemplateId: "hdfc-bank",
    accountLabel: "Personal account",
    fields: [
      { fieldKey: "account-holder", value: "A. Owner" },
      { fieldKey: "masked-account-number", value: "•••• 4821" },
      { fieldKey: "recovery-path", value: "Contact the branch using the policy document." }
    ],
    instructions: { action: "contact_provider" },
    releasePolicy: { audience: "owner_only" },
    review: { frequency: "6_months", lastReviewedAt: NOW },
    ...overrides
  }, {
    now: () => NOW,
    idFactory: options.idFactory ?? (() => "legacy-record-1"),
    featureFlags: options.featureFlags
  });
}

test("creates an empty versioned aggregate without server-visible owner identity", () => {
  const legacy = createDigitalLegacy({ now: () => NOW });
  assert.deepEqual(legacy, {
    schemaVersion: DIGITAL_LEGACY_SCHEMA_VERSION,
    catalogueVersion: CATALOGUE_VERSION,
    scoreSpecVersion: SCORE_SPEC_VERSION,
    createdAt: NOW,
    updatedAt: NOW,
    categoryReviews: [],
    customCategories: [],
    customServices: [],
    records: []
  });
  assert.equal("ownerUserId" in legacy, false);
});

test("creates multiple records for one service with normalized classified fields", () => {
  const first = makeRecord({}, { idFactory: () => "one" });
  const second = makeRecord({ accountLabel: "Joint account" }, { idFactory: () => "two" });
  assert.notEqual(first.id, second.id);
  assert.equal(first.serviceTemplateId, second.serviceTemplateId);
  assert.equal(first.fields[0].classification, "identity_information");
  assert.equal(first.fields[2].classification, "personal_instruction");
  assert.deepEqual(validateLegacyRecord(first), { valid: true, errors: [] });
});

test("prohibited transient and payment verification secrets can never be stored", () => {
  for (const fieldKey of ["otp", "temporary-code", "cvv"]) {
    assert.throws(() => makeRecord({ fields: [{ fieldKey, value: "123456" }] }), /must not be stored/i);
  }
});

test("credential fields are independently disabled and never enabled by the catalogue flag", () => {
  assert.throws(() => makeRecord({ fields: [{ fieldKey: "password", value: "secret" }] }), /credential fields are disabled/i);
  assert.throws(() => makeRecord({ fields: [{ fieldKey: "password", value: "secret" }] }, {
    featureFlags: { serviceCatalogue: true, credentialFields: false }
  }), /credential fields are disabled/i);

  const record = makeRecord({ fields: [{ fieldKey: "password", value: "secret" }] }, {
    featureFlags: { credentialFields: true }
  });
  assert.equal(record.fields[0].revealPolicy, "recent_auth");
});

test("private keys and seed phrases remain disabled pending independent review", () => {
  for (const fieldKey of ["seed-phrase", "private-key", "password-manager-master-password"]) {
    assert.throws(() => makeRecord({ fields: [{ fieldKey, value: "high risk" }] }, {
      featureFlags: { credentialFields: true }
    }), /independent security review/i);
  }
});

test("release settings are explicitly intent only in the whole-vault architecture", () => {
  const policy = resolveReleaseIntent({
    audience: "instructions_only",
    recipientMode: "selected",
    nomineeHolderIds: ["holder-2", "holder-2", "holder-1"],
    trigger: "existing_circle"
  });
  assert.deepEqual(policy, {
    audience: "instructions_only",
    recipientMode: "selected",
    nomineeHolderIds: ["holder-2", "holder-1"],
    trigger: "existing_circle",
    enforcement: "intent_only"
  });
});

test("record status is derived from record facts rather than trusted input", () => {
  const current = makeRecord();
  assert.equal(deriveRecordStatus(current, { now: NOW }), "protected");
  assert.equal(deriveRecordStatus({ ...current, fields: [] }, { now: NOW }), "incomplete");
  assert.equal(deriveRecordStatus({ ...current, archivedAt: NOW }, { now: NOW }), "archived");
  assert.equal(deriveRecordStatus({ ...current, releasedAt: NOW }, { now: NOW }), "released");
  assert.equal(deriveRecordStatus({
    ...current,
    review: { ...current.review, nextReviewAt: "2026-08-01T00:00:00.000Z" }
  }, { now: NOW }), "needs_review");
  assert.equal(deriveRecordStatus({
    ...current,
    releasePolicy: resolveReleaseIntent({ audience: "instructions_only", recipientMode: "primary" })
  }, { now: NOW }), "scheduled_for_release");
});
