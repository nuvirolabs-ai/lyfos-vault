import test from "node:test";
import assert from "node:assert/strict";

import { getService, listServices, searchServiceTemplates } from "./catalogue.js";
import {
  DEFAULT_REGION,
  REGIONS,
  applyRegionToFieldKeys,
  fieldLabelForRegion,
  getRegion,
  isFieldHiddenInRegion,
  normalizeRegion,
  regionCurrency,
  regionRelevance
} from "./regions.js";
import { LEGACY_SERVICE_TEMPLATES } from "./services.js";

test("unknown or missing region codes fall back to the default", () => {
  assert.equal(normalizeRegion("us"), "US");
  assert.equal(normalizeRegion(" gb "), "GB");
  assert.equal(normalizeRegion("ZZ"), DEFAULT_REGION);
  assert.equal(normalizeRegion(null), DEFAULT_REGION);
  assert.equal(normalizeRegion(undefined), DEFAULT_REGION);
  assert.equal(getRegion("nonsense").code, DEFAULT_REGION);
});

test("every region declares a currency", () => {
  for (const region of REGIONS) assert.match(regionCurrency(region.code), /^[A-Z]{3}$/);
});

// The property that matters most: a vault written in one country has to keep
// working in another. Region must never remove a template from resolution.
test("template lookup is region-blind", () => {
  for (const id of ["hdfc-bank", "aadhaar", "public-provident-fund", "chase-bank", "sipp", "emirates-id"]) {
    assert.ok(getService(id), `${id} should resolve`);
  }
});

test("another region's services stay listed, just ranked lower", () => {
  const fromUs = listServices({ categoryId: "banking-payments", region: "US" });
  const ids = fromUs.map((service) => service.id);
  assert.ok(ids.includes("hdfc-bank"), "an Indian bank must still be reachable from the US");
  assert.ok(ids.indexOf("chase-bank") < ids.indexOf("hdfc-bank"), "local banks rank first");
});

test("search finds another region's service — an NRI keeps their Indian accounts", () => {
  assert.equal(searchServiceTemplates("HDFC", { region: "US" })[0].id, "hdfc-bank");
  assert.equal(searchServiceTemplates("SBI", { region: "GB" })[0].id, "state-bank-of-india");
  assert.equal(searchServiceTemplates("Chase", { region: "IN" })[0].id, "chase-bank");
});

test("quick-picks are the one place region narrows", () => {
  for (const [region, expected, unwanted] of [
    ["US", "chase-bank", "hdfc-bank"],
    ["GB", "barclays", "chase-bank"],
    ["AE", "emirates-nbd", "barclays"],
    ["IN", "hdfc-bank", "barclays"]
  ]) {
    const ids = listServices({ categoryId: "banking-payments", featuredOnly: true, region }).map((s) => s.id);
    assert.ok(ids.includes(expected), `${region} quick-picks should include ${expected}`);
    assert.ok(!ids.includes(unwanted), `${region} quick-picks should not include ${unwanted}`);
  }
});

test("universal services appear in every region's quick-picks", () => {
  for (const region of ["IN", "US", "GB", "AE"]) {
    const ids = listServices({ categoryId: "banking-payments", featuredOnly: true, region }).map((s) => s.id);
    assert.ok(ids.includes("paypal"), `PayPal should be offered in ${region}`);
  }
});

test("omitting region preserves the original list and order", () => {
  const a = listServices({ categoryId: "banking-payments" });
  const b = listServices({ categoryId: "banking-payments" });
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((s) => s.sortOrder), [...a.map((s) => s.sortOrder)].sort((x, y) => x - y));
});

test("India-only shopping services are tagged, not offered worldwide", () => {
  for (const id of ["flipkart", "swiggy", "zomato", "myntra", "ola"]) {
    assert.deepEqual(getService(id).countryCodes, ["IN"], `${id} must be tagged IN`);
  }
  const usIds = listServices({ categoryId: "shopping-travel-subscriptions", featuredOnly: true, region: "US" }).map((s) => s.id);
  assert.ok(!usIds.includes("flipkart"));
  assert.ok(usIds.includes("amazon-shopping"), "Amazon is universal and should remain");
});

test("every region has a usable banking and identity quick-pick list", () => {
  for (const region of REGIONS.map((r) => r.code)) {
    for (const categoryId of ["banking-payments", "investments-wealth", "government-identity"]) {
      const list = listServices({ categoryId, featuredOnly: true, region });
      assert.ok(list.length >= 4, `${region}/${categoryId} had only ${list.length} quick-picks`);
    }
  }
});

test("regionRelevance ranks own region, then universal, then elsewhere", () => {
  assert.equal(regionRelevance({ countryCodes: ["US"] }, "US"), 0);
  assert.equal(regionRelevance({ countryCodes: [] }, "US"), 1);
  assert.equal(regionRelevance({ countryCodes: ["IN"] }, "US"), 2);
});

test("field labels follow the local banking system", () => {
  assert.equal(fieldLabelForRegion("branch", "Branch", "IN"), "Branch");
  assert.equal(fieldLabelForRegion("branch", "Branch", "US"), "Routing number (ABA)");
  assert.equal(fieldLabelForRegion("branch", "Branch", "GB"), "Sort code");
  assert.equal(fieldLabelForRegion("branch", "Branch", "AE"), "IBAN");
  // "Nominee" on a bank account is a South Asian term; elsewhere it's a beneficiary.
  assert.equal(fieldLabelForRegion("nominee-information", "Existing provider nominee", "US"), "Beneficiary on the account");
  // A field a region says nothing about keeps the catalogue's own label.
  assert.equal(fieldLabelForRegion("account-label", "Account label", "GB"), "Account label");
});

test("regions drop fields their banks do not issue", () => {
  assert.ok(isFieldHiddenInRegion("customer-id", "US"));
  assert.ok(isFieldHiddenInRegion("relationship-manager", "GB"));
  assert.ok(!isFieldHiddenInRegion("customer-id", "IN"));

  const keys = ["account-label", "customer-id", "branch", "relationship-manager"];
  assert.deepEqual(applyRegionToFieldKeys(keys, "US"), ["account-label", "branch"]);
  assert.deepEqual(applyRegionToFieldKeys(keys, "IN"), keys);
});

test("no duplicate template ids were introduced by the region packs", () => {
  const seen = new Set();
  for (const service of LEGACY_SERVICE_TEMPLATES) {
    assert.ok(!seen.has(service.id), `duplicate template id: ${service.id}`);
    seen.add(service.id);
  }
});
