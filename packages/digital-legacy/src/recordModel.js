import {
  CATALOGUE_VERSION,
  DIGITAL_LEGACY_SCHEMA_VERSION,
  FIELD_CLASSIFICATIONS,
  LEGACY_ACTIONS,
  SCORE_SPEC_VERSION
} from "./constants.js";
import { getCategory, getService } from "./catalogue.js";
import { FIELD_TEMPLATES } from "./fieldTemplates.js";
import { resolveReleaseIntent, validateReleaseIntent } from "./permissions.js";
import { deriveRecordStatus } from "./status.js";

function isoNow(now) {
  const value = typeof now === "function" ? now() : now;
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new Error("A valid current time is required.");
  return date.toISOString();
}

function secureRecordId() {
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure random record IDs are unavailable.");
  return globalThis.crypto.randomUUID();
}

function normalizeReview(review = {}) {
  const frequencies = new Set(["3_months", "6_months", "yearly", "custom", "none"]);
  return {
    frequency: frequencies.has(review.frequency) ? review.frequency : "yearly",
    ...(review.customDays ? { customDays: Math.max(1, Math.round(Number(review.customDays))) } : {}),
    ...(review.lastReviewedAt ? { lastReviewedAt: new Date(review.lastReviewedAt).toISOString() } : {}),
    ...(review.nextReviewAt ? { nextReviewAt: new Date(review.nextReviewAt).toISOString() } : {})
  };
}

function normalizeField(input, featureFlags = {}, customFields = new Map()) {
  const fieldKey = String(input?.fieldKey ?? "").trim();
  const template = FIELD_TEMPLATES[fieldKey] ?? customFields.get(fieldKey);
  if (!template) throw new Error(`Unknown Digital Legacy field: ${fieldKey || "missing"}.`);
  if (template.storagePolicy === "prohibited") {
    throw new Error(`${template.label} must not be stored in Lyfos.`);
  }
  if (template.storagePolicy === "feature_gated" && featureFlags.credentialFields !== true) {
    throw new Error("Credential fields are disabled for this build.");
  }
  if (template.storagePolicy === "disabled_pending_review" && featureFlags.criticalSecrets !== true) {
    throw new Error(`${template.label} requires an independent security review before storage can be enabled.`);
  }
  return {
    fieldKey,
    classification: template.classification,
    value: input.value,
    revealPolicy: template.revealRequiresReauthentication ? "recent_auth" : "normal",
    copyPolicy: template.copyAllowed ? "confirm" : "disabled"
  };
}

export function createDigitalLegacy({ now } = {}) {
  const timestamp = isoNow(now);
  return {
    schemaVersion: DIGITAL_LEGACY_SCHEMA_VERSION,
    catalogueVersion: CATALOGUE_VERSION,
    scoreSpecVersion: SCORE_SPEC_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    categoryReviews: [],
    customCategories: [],
    customServices: [],
    records: []
  };
}

export function createLegacyRecord(input = {}, options = {}) {
  const timestamp = isoNow(options.now);
  const category = getCategory(input.categoryId);
  if (!category) throw new Error("Choose a valid Digital Legacy category.");
  const service = input.serviceTemplateId ? getService(input.serviceTemplateId) : null;
  if (input.serviceTemplateId && (!service || service.categoryId !== category.id)) {
    throw new Error("Choose a service from the selected category.");
  }
  if (!service && !input.customServiceId && category.id !== "custom") {
    throw new Error("Choose a service or a custom service.");
  }

  const customFields = new Map((options.customFieldTemplates ?? []).map((field) => [field.id, field]));
  const record = {
    id: (options.idFactory ?? secureRecordId)(),
    categoryId: category.id,
    ...(service ? { serviceTemplateId: service.id } : {}),
    ...(input.customServiceId ? { customServiceId: String(input.customServiceId) } : {}),
    accountLabel: String(input.accountLabel ?? "").trim(),
    tags: [...new Set((input.tags ?? []).map((tag) => String(tag).trim()).filter(Boolean))],
    fields: (input.fields ?? []).map((field) => normalizeField(field, options.featureFlags, customFields)),
    instructions: {
      action: LEGACY_ACTIONS.includes(input.instructions?.action) ? input.instructions.action : "custom",
      ...(input.instructions?.customText ? { customText: String(input.instructions.customText) } : {})
    },
    releasePolicy: resolveReleaseIntent(input.releasePolicy),
    review: normalizeReview(input.review),
    attachments: Array.isArray(input.attachments) ? input.attachments.map((attachment) => ({ ...attachment })) : [],
    createdAt: input.createdAt ? new Date(input.createdAt).toISOString() : timestamp,
    updatedAt: timestamp,
    ...(input.archivedAt ? { archivedAt: new Date(input.archivedAt).toISOString() } : {}),
    ...(input.releasedAt ? { releasedAt: new Date(input.releasedAt).toISOString() } : {})
  };
  return { ...record, status: deriveRecordStatus(record, { now: timestamp }) };
}

export function validateLegacyRecord(record = {}, { customFieldTemplates = [] } = {}) {
  const errors = [];
  const customFields = new Map(customFieldTemplates.map((field) => [field.id, field]));
  const category = getCategory(record.categoryId);
  const service = record.serviceTemplateId ? getService(record.serviceTemplateId) : null;
  if (!record.id || !String(record.id).trim()) errors.push("record id is required");
  if (!category) errors.push("category is invalid");
  if (record.serviceTemplateId && (!service || service.categoryId !== record.categoryId)) errors.push("service does not belong to category");
  if (!record.serviceTemplateId && !record.customServiceId && record.categoryId !== "custom") errors.push("service is required");
  for (const field of record.fields ?? []) {
    const template = FIELD_TEMPLATES[field.fieldKey] ?? customFields.get(field.fieldKey);
    if (!template) errors.push(`field is unknown: ${field.fieldKey}`);
    else if (field.classification !== template.classification || !FIELD_CLASSIFICATIONS.includes(field.classification)) {
      errors.push(`field classification does not match: ${field.fieldKey}`);
    }
    if (template?.storagePolicy === "prohibited") errors.push(`prohibited field is present: ${field.fieldKey}`);
  }
  if (!LEGACY_ACTIONS.includes(record.instructions?.action)) errors.push("legacy action is invalid");
  errors.push(...validateReleaseIntent(record.releasePolicy));
  return { valid: errors.length === 0, errors };
}
