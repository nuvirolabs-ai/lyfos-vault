import test from "node:test";
import assert from "node:assert/strict";

import { migrateLegacyVault } from "./index.js";

const NOW = "2026-08-02T10:00:00.000Z";

function item(type, id, overrides = {}) {
  return {
    id,
    type,
    title: `${type} title`,
    username: "private-user",
    secret: "existing-secret",
    notes: "existing notes",
    emergencyEligible: true,
    attachments: [{ id: `${id}-attachment`, dataUrl: "data:text/plain;base64,cHJpdmF0ZQ==" }],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("migration maps only deterministic legacy types and isolates ambiguous records", () => {
  const source = {
    version: 1,
    items: [
      item("bank_account", "bank"),
      item("email_account", "email"),
      item("identity_document", "identity"),
      item("insurance_policy", "insurance"),
      item("card", "card"),
      item("password", "password"),
      item("pin", "pin"),
      item("important_document", "document"),
      item("emergency_instruction", "instruction")
    ]
  };

  const result = migrateLegacyVault(source, { now: () => NOW });
  const records = new Map(result.vault.digitalLegacy.records.map((record) => [record.id, record]));

  assert.equal(records.get("bank").categoryId, "banking-payments");
  assert.equal(records.get("email").categoryId, "email-communication");
  assert.equal(records.get("identity").categoryId, "government-identity");
  assert.equal(records.get("insurance").categoryId, "insurance");
  assert.equal(records.get("card").categoryId, "banking-payments");
  for (const id of ["password", "pin", "document", "instruction"]) {
    assert.equal(records.get(id).categoryId, "custom");
    assert.equal(records.get(id).customCategoryId, "imported-legacy-records");
  }
  assert.equal(result.report.deterministic, 5);
  assert.equal(result.report.needsOwnerReview, 4);
});

test("migration preserves original items and references sensitive content without duplicating it", () => {
  const source = { version: 1, items: [item("bank_account", "bank")] };
  const before = structuredClone(source);
  const result = migrateLegacyVault(source, { now: () => NOW });
  const migrated = result.vault.digitalLegacy.records[0];

  assert.deepEqual(source, before);
  assert.deepEqual(result.vault.items, before.items);
  assert.equal(migrated.id, "bank");
  assert.equal(migrated.legacyItemId, "bank");
  assert.equal(migrated.createdAt, "2025-01-01T00:00:00.000Z");
  assert.equal(migrated.updatedAt, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(migrated.legacyAttachmentIds, ["bank-attachment"]);
  assert.deepEqual(migrated.fields, []);
  assert.equal(JSON.stringify(migrated).includes("existing-secret"), false);
  assert.equal(JSON.stringify(migrated).includes("data:text/plain"), false);
});

test("historical emergency choice is retained as intent and never upgraded to enforcement", () => {
  const result = migrateLegacyVault({
    version: 1,
    items: [
      item("bank_account", "release-intent", { emergencyEligible: true }),
      item("bank_account", "private-intent", { emergencyEligible: false })
    ]
  }, { now: () => NOW });
  const [releaseIntent, privateIntent] = result.vault.digitalLegacy.records;
  assert.equal(releaseIntent.releasePolicy.audience, "instructions_only");
  assert.equal(privateIntent.releasePolicy.audience, "owner_only");
  assert.equal(releaseIntent.releasePolicy.enforcement, "intent_only");
  assert.equal(privateIntent.releasePolicy.enforcement, "intent_only");
  assert.equal(releaseIntent.migration.historicalEmergencyEligible, true);
});

test("migration is idempotent and does not replace an existing Digital Legacy aggregate", () => {
  const first = migrateLegacyVault({ version: 1, items: [item("bank_account", "bank")] }, { now: () => NOW });
  const second = migrateLegacyVault(first.vault, { now: () => "2027-01-01T00:00:00.000Z" });
  assert.equal(first.migrated, true);
  assert.equal(second.migrated, false);
  assert.equal(second.vault.digitalLegacy, first.vault.digitalLegacy);
  assert.deepEqual(second.report, { reason: "digital_legacy_already_present", deterministic: 0, needsOwnerReview: 0, total: 0 });
});

test("migration handles an empty or malformed old items collection safely", () => {
  const result = migrateLegacyVault({ version: 1, items: null }, { now: () => NOW });
  assert.equal(result.migrated, true);
  assert.deepEqual(result.vault.digitalLegacy.records, []);
  assert.deepEqual(result.report, { reason: "migration_created", deterministic: 0, needsOwnerReview: 0, total: 0 });
});
