import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BRAND_ASSETS,
  LEGACY_CATEGORIES,
  LEGACY_SERVICE_TEMPLATES,
  resolveBrandAsset,
  validateBrandAssets
} from "./index.js";

test("every category and service icon resolves to a bundled generic asset", () => {
  for (const item of [...LEGACY_CATEGORIES, ...LEGACY_SERVICE_TEMPLATES]) {
    const asset = resolveBrandAsset(item.iconKey);
    assert.equal(asset.usageStatus, "generic-only");
    assert.match(asset.filePath, /^\/assets\/legacy-services\/generic\/[a-z-]+\.svg$/);
    assert.equal(/^https?:/.test(asset.filePath), false);
  }
  assert.deepEqual(validateBrandAssets(), { valid: true, errors: [] });
});

test("theme resolution is deterministic and falls back without inventing a brand variant", () => {
  const light = resolveBrandAsset("banking", { theme: "light" });
  const dark = resolveBrandAsset("banking", { theme: "dark" });
  assert.equal(light.filePath, "/assets/legacy-services/generic/banking.svg");
  assert.equal(dark.filePath, light.filePath);
  assert.equal(resolveBrandAsset("unknown").filePath, BRAND_ASSETS.generic.filePath);
});

test("web asset metadata mirrors the shared contract", () => {
  const metadata = JSON.parse(readFileSync(new URL("../../../apps/web/public/assets/legacy-services/metadata.json", import.meta.url), "utf8"));
  assert.equal(metadata.version, "2026.08.1");
  assert.deepEqual(metadata.assets, Object.values(BRAND_ASSETS));
});

test("all declared SVG files exist and avoid scripts, links, and embedded images", () => {
  for (const asset of Object.values(BRAND_ASSETS)) {
    const relativePath = `../../../apps/web/public${asset.filePath}`;
    const svg = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.equal(/<script|<image|<a\b|href=|onload=/i.test(svg), false);
  }
});
