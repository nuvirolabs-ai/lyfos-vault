import test from "node:test";
import assert from "node:assert/strict";

import {
  FIELD_TEMPLATES,
  LEGACY_CATEGORIES,
  LEGACY_SERVICE_TEMPLATES,
  getCategory,
  getService,
  listServices,
  searchServiceTemplates,
  validateCatalogue
} from "./index.js";

const REQUIRED_CATEGORY_IDS = [
  "banking-payments",
  "investments-wealth",
  "social-media",
  "email-communication",
  "devices-ecosystems",
  "cloud-digital-files",
  "government-identity",
  "insurance",
  "property-physical-assets",
  "business-professional",
  "shopping-travel-subscriptions",
  "health-medical",
  "memories-personal-archives",
  "password-managers-recovery",
  "custom"
];

test("catalogue defines every Phase 2 category in stable display order", () => {
  assert.deepEqual(LEGACY_CATEGORIES.map((category) => category.id), REQUIRED_CATEGORY_IDS);
  assert.equal(new Set(LEGACY_CATEGORIES.map((category) => category.slug)).size, LEGACY_CATEGORIES.length);
  assert.ok(LEGACY_CATEGORIES.every((category, index) => category.sortOrder === index + 1));
  assert.ok(LEGACY_CATEGORIES.every((category) => ["standard", "high", "critical"].includes(category.sensitivityLevel)));
  assert.ok(Object.isFrozen(LEGACY_CATEGORIES));
});

test("catalogue contains the requested service breadth without unapproved brand assets", () => {
  const requiredServices = [
    "hdfc-bank",
    "state-bank-of-india",
    "zerodha",
    "instagram",
    "gmail",
    "apple-id",
    "google-drive",
    "aadhaar",
    "life-insurance",
    "residential-property",
    "github",
    "amazon-shopping",
    "health-records",
    "family-photos",
    "bitwarden"
  ];

  assert.ok(LEGACY_SERVICE_TEMPLATES.length >= 100);
  for (const serviceId of requiredServices) {
    const service = getService(serviceId);
    assert.equal(service?.id, serviceId);
    assert.equal(service.iconSource, "generic");
    assert.equal(service.brandAssetApproved, false);
  }
});

test("service aliases and category filters are deterministic", () => {
  assert.equal(searchServiceTemplates("SBI")[0].id, "state-bank-of-india");
  assert.equal(searchServiceTemplates("BOB")[0].id, "bank-of-baroda");
  assert.ok(searchServiceTemplates("Insta").some((service) => service.id === "instagram"));
  assert.ok(searchServiceTemplates("Gmail").some((service) => service.id === "gmail"));
  assert.ok(searchServiceTemplates("Gmail").some((service) => service.id === "google-account"));

  const banking = listServices({ categoryId: "banking-payments" });
  assert.ok(banking.length >= 15);
  assert.ok(banking.every((service) => service.categoryId === "banking-payments"));
  assert.deepEqual(banking, listServices({ categoryId: "banking-payments" }));
});

test("field templates are encrypted aggregate fields with explicit critical-field policy", () => {
  assert.equal(FIELD_TEMPLATES["account-label"].encrypted, true);
  assert.equal(FIELD_TEMPLATES.password.classification, "authentication_secret");
  assert.equal(FIELD_TEMPLATES.password.storagePolicy, "feature_gated");
  assert.equal(FIELD_TEMPLATES.otp.storagePolicy, "prohibited");
  assert.equal(FIELD_TEMPLATES.cvv.storagePolicy, "prohibited");
  assert.equal(FIELD_TEMPLATES["seed-phrase"].storagePolicy, "disabled_pending_review");
  assert.ok(Object.values(FIELD_TEMPLATES).every((field) => field.searchable === false));
});

test("catalogue validates referential integrity and public lookups do not expose mutable config", () => {
  assert.deepEqual(validateCatalogue(), { valid: true, errors: [] });
  assert.equal(getCategory("banking-payments")?.name, "Banking and payments");
  assert.equal(getCategory("missing"), null);
  assert.equal(getService("missing"), null);
  assert.ok(Object.isFrozen(getService("hdfc-bank")));
});
