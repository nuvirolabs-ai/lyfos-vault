export const DIGITAL_LEGACY_SCHEMA_VERSION = 1;
export const CATALOGUE_VERSION = "2026.08.1";
export const SCORE_SPEC_VERSION = "1.0";

export const SENSITIVITY_LEVELS = Object.freeze(["standard", "high", "critical"]);

export const FIELD_CLASSIFICATIONS = Object.freeze([
  "identity_information",
  "account_information",
  "authentication_secret",
  "financial_secret",
  "recovery_secret",
  "private_cryptographic_key",
  "personal_instruction",
  "supporting_document"
]);

export const LEGACY_ACTIONS = Object.freeze([
  "transfer",
  "memorialise",
  "close",
  "delete",
  "archive",
  "contact_provider",
  "release_information",
  "custom"
]);

export const LEGACY_RECORD_STATUSES = Object.freeze([
  "started",
  "protected",
  "incomplete",
  "needs_review",
  "action_required",
  "scheduled_for_release",
  "released",
  "archived"
]);

export const STORAGE_POLICIES = Object.freeze([
  "allowed",
  "feature_gated",
  "disabled_pending_review",
  "prohibited"
]);

export const RELEASE_AUDIENCES = Object.freeze([
  "owner_only",
  "existence_only",
  "instructions_only",
  "full_record"
]);

export const RECIPIENT_MODES = Object.freeze([
  "primary",
  "backup_fallback",
  "all_authorized",
  "selected"
]);

export function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
