const FLAG_KEYS = Object.freeze({
  dashboard: "VITE_FEATURE_DIGITAL_LEGACY_DASHBOARD",
  serviceCatalogue: "VITE_FEATURE_DIGITAL_LEGACY_CATALOGUE",
  credentialFields: "VITE_FEATURE_DIGITAL_LEGACY_CREDENTIALS",
  officialBrandIcons: "VITE_FEATURE_DIGITAL_LEGACY_OFFICIAL_ICONS",
  score: "VITE_FEATURE_DIGITAL_LEGACY_SCORE",
  reviewReminders: "VITE_FEATURE_DIGITAL_LEGACY_REVIEW_REMINDERS",
  nomineeFieldPermissions: "VITE_FEATURE_DIGITAL_LEGACY_NOMINEE_FIELDS",
  customServiceIcons: "VITE_FEATURE_DIGITAL_LEGACY_CUSTOM_ICONS"
});

function exactlyEnabled(value) {
  return value === "true" || value === "1";
}

export function getDigitalLegacyFeatureFlags(env = import.meta.env ?? {}) {
  return Object.fromEntries(Object.entries(FLAG_KEYS).map(([name, key]) => [name, exactlyEnabled(env[key])]));
}

export const DIGITAL_LEGACY_FEATURE_FLAGS = Object.freeze(getDigitalLegacyFeatureFlags());
