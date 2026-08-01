import test from "node:test";
import assert from "node:assert/strict";

import { PLANS, entitlementsFor, isPaid, paidPlans } from "./plans.js";

test("free forever allows 11 entries and locks paid features", () => {
  const free = entitlementsFor(null);

  assert.equal(free.effective, "free");
  assert.equal(free.vaultItemLimit, 11);
  assert.equal(free.balanceSheetEnabled, false);
  assert.equal(free.releaseEnabled, false);
});

test("vault is the only paid plan and enables the complete product", () => {
  const vault = entitlementsFor({ plan: "vault", status: "active" });

  assert.equal(isPaid("vault"), true);
  assert.equal(isPaid("family"), false);
  assert.deepEqual(paidPlans().map((plan) => plan.id), ["vault"]);
  assert.equal(vault.vaultItemLimit, Infinity);
  assert.equal(vault.balanceSheetEnabled, true);
  assert.equal(vault.releaseEnabled, true);
  assert.equal(vault.amountInr, 99900);
  assert.equal(vault.amountUsd, 900);
});

test("unknown or retired plans fall back to free entitlements", () => {
  const family = entitlementsFor({ plan: "family", status: "active" });

  assert.equal(family.effective, "free");
  assert.equal(family.vaultItemLimit, 11);
  assert.equal(family.releaseEnabled, false);
});
