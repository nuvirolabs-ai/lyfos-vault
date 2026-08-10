// Which country's banks, IDs and field labels to put in front of this user.
//
// Detected locally — locale and timezone only. No IP lookup, no geo API, no
// request leaves the device. Region is a presentation preference, so it lives
// in localStorage rather than the encrypted vault: it must be readable before
// unlock, and it says nothing about the vault's contents.

import { DEFAULT_REGION, REGIONS, normalizeRegion } from "@os-one/digital-legacy";

const STORAGE_KEY = "lyfos-region";

// Only timezones that map unambiguously to a region we ship a pack for.
// Anything else falls through to the locale, then to the default.
const TIMEZONE_REGIONS = {
  "asia/kolkata": "IN",
  "asia/calcutta": "IN",
  "asia/dubai": "AE",
  "europe/london": "GB"
};

function fromLocale() {
  try {
    // `en-GB` → GB. The region subtag is the strongest signal a browser gives
    // us, because the user chose it.
    const locales = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean);
    for (const locale of locales) {
      const parts = String(locale).split("-");
      const tag = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "";
      if (tag && REGIONS.some((region) => region.code === tag)) return tag;
    }
  } catch {
    // Fall through.
  }
  return null;
}

function fromTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (TIMEZONE_REGIONS[tz.toLowerCase()]) return TIMEZONE_REGIONS[tz.toLowerCase()];
    // IST has no other occupant, so the offset alone is conclusive for India.
    if (new Date().getTimezoneOffset() === -330) return "IN";
  } catch {
    // Fall through.
  }
  return null;
}

/** The region we'd guess with no stored preference. Exported for tests. */
export function detectRegion() {
  return normalizeRegion(fromLocale() ?? fromTimezone() ?? DEFAULT_REGION);
}

/** Stored override if the user picked one, otherwise the guess. */
export function getRegionPreference() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && REGIONS.some((region) => region.code === saved)) return saved;
  } catch {
    // Storage unavailable — fall back to detection.
  }
  return detectRegion();
}

/** Remember an explicit choice. Returns the value actually stored. */
export function setRegionPreference(code) {
  const next = normalizeRegion(code);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Non-fatal: the guess still applies for this session.
  }
  return next;
}

export { REGIONS, DEFAULT_REGION };
