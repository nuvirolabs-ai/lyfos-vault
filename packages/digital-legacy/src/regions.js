// Region packs.
//
// A region changes two things and nothing else:
//   1. which service templates are FEATURED (the quick-pick list in the picker)
//   2. how a handful of banking/identity fields are labelled
//
// It never changes which templates EXIST. `getService(id)` and search stay
// region-blind on purpose: a vault written in India must still resolve — and
// still be searchable — when its owner is living in Dubai, and when their
// family opens it from anywhere. Filtering the catalogue by region would break
// exactly the people most likely to need Lyfos.

import { deepFreeze } from "./constants.js";

export const DEFAULT_REGION = "IN";

export const REGIONS = deepFreeze([
  {
    code: "IN",
    label: "India",
    currency: "INR",
    // India is the baseline the catalogue was authored in, so no overrides.
    fieldLabels: {},
    hideFields: []
  },
  {
    code: "US",
    label: "United States",
    currency: "USD",
    fieldLabels: {
      branch: "Routing number (ABA)",
      "nominee-information": "Beneficiary on the account",
      "registered-phone": "Registered phone number"
    },
    // US banks don't issue a customer ID, and retail banking has no
    // relationship manager — showing them reads as a form built elsewhere.
    hideFields: ["customer-id", "relationship-manager"]
  },
  {
    code: "GB",
    label: "United Kingdom",
    currency: "GBP",
    fieldLabels: {
      branch: "Sort code",
      "nominee-information": "Beneficiary on the account",
      "registered-phone": "Registered phone number"
    },
    hideFields: ["customer-id", "relationship-manager"]
  },
  {
    code: "AE",
    label: "United Arab Emirates",
    currency: "AED",
    fieldLabels: {
      branch: "IBAN",
      "nominee-information": "Beneficiary on the account"
    },
    hideFields: ["customer-id"]
  }
]);

const regionByCode = new Map(REGIONS.map((region) => [region.code, region]));

/** Coerce anything into a supported region code. Unknown input → DEFAULT_REGION. */
export function normalizeRegion(code) {
  const value = String(code ?? "").trim().toUpperCase();
  return regionByCode.has(value) ? value : DEFAULT_REGION;
}

export function getRegion(code) {
  return regionByCode.get(normalizeRegion(code)) ?? null;
}

/** Currency a region defaults to. The user can still override it. */
export function regionCurrency(code) {
  return getRegion(code)?.currency ?? "INR";
}

/**
 * Label for a field in a region. Falls back to the catalogue's own label, so
 * a region that says nothing about a field simply inherits it.
 */
export function fieldLabelForRegion(fieldKey, fallbackLabel, code) {
  return getRegion(code)?.fieldLabels?.[fieldKey] ?? fallbackLabel;
}

/** Fields a region suppresses because they don't exist in that banking system. */
export function isFieldHiddenInRegion(fieldKey, code) {
  return (getRegion(code)?.hideFields ?? []).includes(fieldKey);
}

/** Drop the field keys a region has no use for, preserving order. */
export function applyRegionToFieldKeys(fieldKeys, code) {
  const region = getRegion(code);
  if (!region || region.hideFields.length === 0) return [...fieldKeys];
  return fieldKeys.filter((key) => !region.hideFields.includes(key));
}

/**
 * How relevant a template is to a region:
 *   0 — authored for this region
 *   1 — universal (no country tags)
 *   2 — authored for a different region; still findable, just not promoted
 */
export function regionRelevance(service, code) {
  const codes = service?.countryCodes ?? [];
  if (codes.length === 0) return 1;
  return codes.includes(normalizeRegion(code)) ? 0 : 2;
}
