import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const marketingHome = readFileSync(new URL("../../../marketing/index.html", import.meta.url), "utf8");
const marketingPricing = readFileSync(new URL("../../../marketing/pricing/index.html", import.meta.url), "utf8");

test("Vault fall interest forms submit to the backend instead of opening email", () => {
  for (const html of [marketingHome, marketingPricing]) {
    assert.match(html, /data-vault-interest-form/);
    assert.match(html, /Submit email/);
    assert.doesNotMatch(html, /Notify me/);
    assert.doesNotMatch(html, /Notify me when Lyfos Vault launches/);
    assert.doesNotMatch(html, /mailto:hello@nuvirolabs\.com\?subject=.*Lyfos Vault/);
  }
});
