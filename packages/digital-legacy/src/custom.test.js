import test from "node:test";
import assert from "node:assert/strict";

import {
  createCustomCategory,
  createCustomFieldTemplate,
  createCustomService,
  createLegacyRecord
} from "./index.js";

test("custom categories and services use generic assets and owner-scoped identifiers", () => {
  const category = createCustomCategory({ name: "Family ventures" }, { idFactory: () => "category-id" });
  const service = createCustomService({
    customCategoryId: category.id,
    name: "Private partnership",
    aliases: ["Partnership", "Partnership", "  venture  "]
  }, { idFactory: () => "service-id" });

  assert.deepEqual(category, {
    id: "custom-category-category-id",
    name: "Family ventures",
    slug: "family-ventures",
    description: "",
    iconKey: "custom",
    sensitivityLevel: "high",
    isEnabled: true,
    isUserDefined: true
  });
  assert.equal(service.id, "custom-service-service-id");
  assert.equal(service.categoryId, "custom");
  assert.equal(service.customCategoryId, category.id);
  assert.deepEqual(service.aliases, ["Partnership", "venture"]);
  assert.equal(service.iconKey, "custom");
  assert.equal(service.brandAssetApproved, false);
});

test("custom fields remain encrypted, non-searchable and classification constrained", () => {
  const field = createCustomFieldTemplate({
    label: "Provider contact name",
    fieldType: "text",
    classification: "account_information"
  }, { idFactory: () => "field-id" });
  assert.equal(field.id, "custom-field-field-id");
  assert.equal(field.encrypted, true);
  assert.equal(field.searchable, false);
  assert.equal(field.storagePolicy, "allowed");
  assert.equal(field.revealRequiresReauthentication, false);
});

test("custom secret fields use the same independent security gates", () => {
  assert.throws(() => createCustomFieldTemplate({
    label: "Access password",
    fieldType: "password",
    classification: "authentication_secret"
  }), /credential fields are disabled/i);

  const gated = createCustomFieldTemplate({
    label: "Access password",
    fieldType: "password",
    classification: "authentication_secret"
  }, { idFactory: () => "password", featureFlags: { credentialFields: true } });
  assert.equal(gated.storagePolicy, "feature_gated");
  assert.equal(gated.revealRequiresReauthentication, true);

  assert.throws(() => createCustomFieldTemplate({
    label: "Seed words",
    fieldType: "recovery-code",
    classification: "private_cryptographic_key"
  }, { featureFlags: { credentialFields: true } }), /independent security review/i);
});

test("custom model rejects blank names and unsupported executable field types", () => {
  assert.throws(() => createCustomCategory({ name: " " }), /name is required/i);
  assert.throws(() => createCustomService({ customCategoryId: "category", name: " " }), /name is required/i);
  assert.throws(() => createCustomFieldTemplate({
    label: "Dangerous",
    fieldType: "html",
    classification: "account_information"
  }), /field type is not supported/i);
});

test("validated custom field definitions can be used by custom records", () => {
  const field = createCustomFieldTemplate({
    label: "Provider contact name",
    fieldType: "text",
    classification: "account_information"
  }, { idFactory: () => "contact" });
  const record = createLegacyRecord({
    categoryId: "custom",
    customCategoryId: "custom-category-family",
    customServiceId: "custom-service-partnership",
    accountLabel: "Family partnership",
    fields: [{ fieldKey: field.id, value: "Adviser" }],
    instructions: { action: "contact_provider" },
    releasePolicy: { audience: "owner_only" }
  }, {
    idFactory: () => "record",
    now: () => "2026-08-02T00:00:00.000Z",
    customFieldTemplates: [field]
  });
  assert.equal(record.fields[0].fieldKey, field.id);
  assert.equal(record.fields[0].classification, "account_information");
});
