import { createDigitalLegacy } from "./recordModel.js";
import { resolveReleaseIntent } from "./permissions.js";
import { deriveRecordStatus } from "./status.js";

const IMPORTED_CATEGORY_ID = "imported-legacy-records";

const DETERMINISTIC_MAPPINGS = Object.freeze({
  bank_account: { categoryId: "banking-payments", serviceTemplateId: "other-bank", action: "contact_provider" },
  card: { categoryId: "banking-payments", serviceTemplateId: "other-payment-account", action: "contact_provider" },
  email_account: { categoryId: "email-communication", serviceTemplateId: "other-communication-account", action: "archive" },
  identity_document: { categoryId: "government-identity", serviceTemplateId: "other-government-identity", action: "contact_provider" },
  insurance_policy: { categoryId: "insurance", serviceTemplateId: "other-insurance", action: "contact_provider" }
});

function validIso(value, fallback) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function legacyRecord(item, timestamp) {
  const mapping = DETERMINISTIC_MAPPINGS[item?.type] ?? null;
  const releasePolicy = resolveReleaseIntent({
    audience: item?.emergencyEligible ? "instructions_only" : "owner_only",
    recipientMode: "primary",
    trigger: "existing_circle"
  });
  const record = {
    id: String(item?.id ?? "").trim(),
    ...(mapping
      ? { categoryId: mapping.categoryId, serviceTemplateId: mapping.serviceTemplateId }
      : { categoryId: "custom", customCategoryId: IMPORTED_CATEGORY_ID, customServiceId: `imported-${String(item?.type || "record")}` }),
    accountLabel: String(item?.title ?? "Imported record").trim() || "Imported record",
    tags: ["imported"],
    fields: [],
    instructions: { action: mapping?.action ?? "custom" },
    releasePolicy,
    review: { frequency: "yearly" },
    attachments: [],
    legacyItemId: String(item?.id ?? "").trim(),
    legacyAttachmentIds: (Array.isArray(item?.attachments) ? item.attachments : [])
      .map((attachment) => String(attachment?.id ?? "").trim())
      .filter(Boolean),
    migration: {
      sourceSchema: "vault.items.v1",
      sourceType: String(item?.type ?? "unknown"),
      classification: mapping ? "deterministic" : "needs_owner_review",
      historicalEmergencyEligible: item?.emergencyEligible === true,
      contentLocation: "legacy_item_reference"
    },
    createdAt: validIso(item?.createdAt, timestamp),
    updatedAt: validIso(item?.updatedAt, timestamp)
  };
  return { ...record, status: deriveRecordStatus(record, { now: timestamp }) };
}

export function migrateLegacyVault(vault = {}, { now = () => new Date().toISOString() } = {}) {
  if (vault?.digitalLegacy) {
    return {
      vault,
      migrated: false,
      report: { reason: "digital_legacy_already_present", deterministic: 0, needsOwnerReview: 0, total: 0 }
    };
  }

  const timestamp = new Date(typeof now === "function" ? now() : now).toISOString();
  const items = Array.isArray(vault?.items) ? vault.items : [];
  const records = items
    .filter((item) => item?.id)
    .map((item) => legacyRecord(item, timestamp));
  const deterministic = records.filter((record) => record.migration.classification === "deterministic").length;
  const needsOwnerReview = records.length - deterministic;
  const digitalLegacy = {
    ...createDigitalLegacy({ now: () => timestamp }),
    customCategories: needsOwnerReview > 0 ? [{
      id: IMPORTED_CATEGORY_ID,
      name: "Imported legacy records",
      description: "Older vault records that Lyfos will not classify without your review.",
      iconKey: "custom",
      sensitivityLevel: "high"
    }] : [],
    customServices: needsOwnerReview > 0
      ? [...new Set(records.filter((record) => record.customServiceId).map((record) => record.customServiceId))]
        .map((id) => ({ id, customCategoryId: IMPORTED_CATEGORY_ID, name: "Imported legacy record", iconKey: "custom" }))
      : [],
    records
  };

  return {
    vault: { ...vault, digitalLegacy },
    migrated: true,
    report: { reason: "migration_created", deterministic, needsOwnerReview, total: records.length }
  };
}

export { IMPORTED_CATEGORY_ID, DETERMINISTIC_MAPPINGS };
