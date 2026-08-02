import { FIELD_CLASSIFICATIONS, SENSITIVITY_LEVELS } from "./constants.js";

const CUSTOM_FIELD_TYPES = Object.freeze([
  "text", "email", "username", "password", "pin", "phone", "url",
  "account-number", "masked-number", "date", "textarea", "select", "file",
  "secure-note", "recovery-code"
]);

function secureId() {
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure random identifiers are unavailable.");
  return globalThis.crypto.randomUUID();
}

function requiredName(value) {
  const name = String(value ?? "").trim();
  if (!name) throw new Error("A name is required.");
  return name.slice(0, 120);
}

function slugify(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "custom";
}

function normalizedId(prefix, idFactory) {
  const id = String((idFactory ?? secureId)()).trim();
  if (!id) throw new Error("A secure identifier is required.");
  return `${prefix}-${id}`;
}

export function createCustomCategory(input = {}, options = {}) {
  const name = requiredName(input.name);
  return {
    id: normalizedId("custom-category", options.idFactory),
    name,
    slug: slugify(name),
    description: String(input.description ?? "").trim().slice(0, 240),
    iconKey: "custom",
    sensitivityLevel: SENSITIVITY_LEVELS.includes(input.sensitivityLevel) ? input.sensitivityLevel : "high",
    isEnabled: true,
    isUserDefined: true
  };
}

export function createCustomService(input = {}, options = {}) {
  const name = requiredName(input.name);
  const customCategoryId = String(input.customCategoryId ?? "").trim();
  if (!customCategoryId) throw new Error("A custom category is required.");
  return {
    id: normalizedId("custom-service", options.idFactory),
    categoryId: "custom",
    customCategoryId,
    name,
    slug: slugify(name),
    aliases: [...new Set((input.aliases ?? []).map((alias) => String(alias).trim()).filter(Boolean))],
    iconKey: "custom",
    iconSource: "generic",
    brandAssetApproved: false,
    suggestedFieldIds: [...new Set(input.suggestedFieldIds ?? [])],
    suggestedActions: [...new Set(input.suggestedActions ?? ["custom"])],
    defaultSensitivityLevel: SENSITIVITY_LEVELS.includes(input.sensitivityLevel) ? input.sensitivityLevel : "high",
    isEnabled: true,
    isUserDefined: true
  };
}

export function createCustomFieldTemplate(input = {}, options = {}) {
  const label = requiredName(input.label);
  if (!CUSTOM_FIELD_TYPES.includes(input.fieldType)) throw new Error("Custom field type is not supported.");
  if (!FIELD_CLASSIFICATIONS.includes(input.classification)) throw new Error("Custom field classification is not supported.");
  if (/\b(otp|one[- ]time|temporary (authentication )?code|cvv)\b/i.test(label)) {
    throw new Error("One-time codes and payment-card CVVs must not be stored in Lyfos.");
  }

  const isPrivateKey = input.classification === "private_cryptographic_key";
  const isCredential = ["authentication_secret", "financial_secret", "recovery_secret"].includes(input.classification);
  if (isPrivateKey && options.featureFlags?.criticalSecrets !== true) {
    throw new Error("Private cryptographic keys require an independent security review before storage can be enabled.");
  }
  if (isCredential && options.featureFlags?.credentialFields !== true) {
    throw new Error("Credential fields are disabled for this build.");
  }

  return {
    id: normalizedId("custom-field", options.idFactory),
    key: slugify(label),
    label,
    fieldType: input.fieldType,
    classification: input.classification,
    helpText: String(input.helpText ?? "").trim().slice(0, 240),
    requiredForReadiness: input.requiredForReadiness === true,
    encrypted: true,
    revealRequiresReauthentication: isCredential || isPrivateKey,
    copyAllowed: !isPrivateKey,
    searchable: false,
    storagePolicy: isPrivateKey ? "disabled_pending_review" : isCredential ? "feature_gated" : "allowed",
    isUserDefined: true
  };
}
