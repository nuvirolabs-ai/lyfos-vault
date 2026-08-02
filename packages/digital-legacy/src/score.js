import { LEGACY_CATEGORIES } from "./categories.js";
import { SCORE_SPEC_VERSION } from "./constants.js";
import { getFreshnessState } from "./review.js";

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function calculateCoverageScore(digitalLegacy = {}) {
  const includedCategories = LEGACY_CATEGORIES.filter((category) => category.id !== "custom" && category.isEnabled);
  const reviewed = new Set((digitalLegacy.records ?? []).map((record) => record.categoryId));
  for (const review of digitalLegacy.categoryReviews ?? []) {
    if (["reviewed", "not_applicable"].includes(review.state)) reviewed.add(review.categoryId);
  }
  const reviewedCategories = includedCategories.filter((category) => reviewed.has(category.id)).length;
  return {
    value: clampScore(includedCategories.length ? (reviewedCategories / includedCategories.length) * 100 : 0),
    reviewedCategories,
    totalCategories: includedCategories.length
  };
}

function readinessForRecord(record) {
  const fields = record.fields ?? [];
  const criteria = {
    accountIdentified: hasValue(record.accountLabel)
      || fields.some((field) => ["identity_information", "account_information"].includes(field.classification) && hasValue(field.value)),
    recoveryPathDocumented: fields.some((field) => field.fieldKey === "recovery-path" && hasValue(field.value)),
    legacyActionSelected: hasValue(record.instructions?.action),
    nomineeAssigned: record.releasePolicy?.audience !== "owner_only"
      && hasValue(record.releasePolicy?.recipientMode),
    supportingInformationIncluded: (record.attachments ?? []).length > 0
      || fields.some((field) => field.classification === "supporting_document" && hasValue(field.value)),
    releaseConditionConfigured: hasValue(record.releasePolicy?.audience)
      && hasValue(record.releasePolicy?.trigger)
  };
  const value = (criteria.accountIdentified ? 15 : 0)
    + (criteria.recoveryPathDocumented ? 20 : 0)
    + (criteria.legacyActionSelected ? 20 : 0)
    + (criteria.nomineeAssigned ? 20 : 0)
    + (criteria.supportingInformationIncluded ? 10 : 0)
    + (criteria.releaseConditionConfigured ? 15 : 0);
  return { recordId: record.id, value, criteria };
}

export function calculateReadinessScore(records = []) {
  const details = records.map(readinessForRecord);
  return {
    value: clampScore(details.length ? details.reduce((sum, item) => sum + item.value, 0) / details.length : 0),
    records: details
  };
}

export function calculateFreshnessScore(records = [], options = {}) {
  const details = records.map((record) => ({
    recordId: record.id,
    ...getFreshnessState(record.review?.lastReviewedAt, options)
  }));
  return {
    value: clampScore(details.length ? details.reduce((sum, item) => sum + item.value, 0) / details.length : 0),
    records: details
  };
}

export function getPreparationLabel(score) {
  const value = clampScore(score);
  if (value === 0) return "Not started";
  if (value < 40) return "Early preparation";
  if (value < 70) return "Partially prepared";
  if (value < 90) return "Well prepared";
  return "Strongly prepared";
}

export function calculateDigitalLegacyScore(digitalLegacy = {}, options = {}) {
  const coverage = calculateCoverageScore(digitalLegacy);
  const readiness = calculateReadinessScore(digitalLegacy.records ?? []);
  const freshness = calculateFreshnessScore(digitalLegacy.records ?? [], options);
  const overall = clampScore((coverage.value * 0.4) + (readiness.value * 0.4) + (freshness.value * 0.2));
  return {
    specVersion: SCORE_SPEC_VERSION,
    overall,
    label: getPreparationLabel(overall),
    coverage,
    readiness,
    freshness
  };
}

const ACTION_PRIORITY = Object.freeze({ action_required: 0, incomplete: 1, needs_review: 2 });

export function createPriorityActions(records = [], limit = 3) {
  return records
    .map((record, index) => ({ record, index, priority: ACTION_PRIORITY[record.status] }))
    .filter(({ priority }) => priority !== undefined)
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .slice(0, Math.max(0, Math.min(3, Number(limit) || 3)))
    .map(({ record }) => ({
      recordId: record.id,
      status: record.status,
      message: record.status === "action_required"
        ? `Check ${record.accountLabel || "this record"} before relying on it.`
        : record.status === "needs_review"
          ? `Confirm that ${record.accountLabel || "this record"} is still current.`
          : `Complete the missing details for ${record.accountLabel || "this record"}.`
    }));
}
