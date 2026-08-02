import { CATALOGUE_VERSION, deepFreeze } from "./constants.js";
import { LEGACY_CATEGORIES } from "./categories.js";
import { LEGACY_SERVICE_TEMPLATES } from "./services.js";

const ICON_KEYS = Object.freeze([
  "banking", "investments", "social", "communication", "devices", "cloud",
  "government", "insurance", "property", "business", "subscriptions", "health",
  "memories", "recovery", "custom", "generic"
]);

export const BRAND_ASSET_VERSION = CATALOGUE_VERSION;

export const BRAND_ASSETS = deepFreeze(Object.fromEntries(ICON_KEYS.map((iconKey) => [iconKey, {
  serviceId: `generic-${iconKey}`,
  iconKey,
  filePath: `/assets/legacy-services/generic/${iconKey}.svg`,
  usageStatus: "generic-only",
  sourceReference: "Lyfos original generic icon",
  lastReviewedAt: "2026-08-02"
}])));

export function resolveBrandAsset(iconKey, { theme = "light" } = {}) {
  const asset = BRAND_ASSETS[iconKey] ?? BRAND_ASSETS.generic;
  const variant = theme === "dark" ? asset.darkVariant : asset.lightVariant;
  return { ...asset, filePath: variant ?? asset.filePath };
}

export function validateBrandAssets() {
  const errors = [];
  for (const item of [...LEGACY_CATEGORIES, ...LEGACY_SERVICE_TEMPLATES]) {
    if (!BRAND_ASSETS[item.iconKey]) errors.push(`missing generic asset: ${item.iconKey}`);
  }
  for (const asset of Object.values(BRAND_ASSETS)) {
    if (!asset.filePath.startsWith("/assets/legacy-services/") || /^https?:/i.test(asset.filePath)) {
      errors.push(`asset is not local: ${asset.iconKey}`);
    }
    if (asset.usageStatus !== "generic-only") errors.push(`unapproved asset status: ${asset.iconKey}`);
  }
  return { valid: errors.length === 0, errors };
}
