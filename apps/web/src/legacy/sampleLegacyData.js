// Phase 3 read-only prototype data.
//
// Built purely in memory with the same validated constructors the real
// create/edit flow will use in Phase 4 — never reads or writes the
// owner's actual encrypted vault, and never persists anywhere. Only
// "allowed" storage-policy fields (see fieldTemplates.js) get sample
// values, so no password/PIN/recovery-code/seed-phrase/OTP/CVV field
// ever renders here, even as fake data.
import { createDigitalLegacy, createLegacyRecord } from "@os-one/digital-legacy";

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function record(input) {
  return createLegacyRecord(input, { now: new Date().toISOString() });
}

export function buildSampleDigitalLegacy() {
  const legacy = createDigitalLegacy();

  const records = [
    record({
      categoryId: "banking-payments",
      serviceTemplateId: "hdfc-bank",
      accountLabel: "HDFC Bank — primary savings",
      tags: ["primary"],
      fields: [
        { fieldKey: "account-holder", value: "Account owner" },
        { fieldKey: "account-type", value: "Savings account" },
        { fieldKey: "masked-account-number", value: "•••• 4821" },
        { fieldKey: "registered-phone", value: "•••••• 4821" },
        { fieldKey: "recovery-path", value: "Branch KYC re-verification with a death certificate and legal heir proof." }
      ],
      instructions: { action: "transfer" },
      releasePolicy: { audience: "instructions_only", recipientMode: "primary", trigger: "existing_circle" },
      review: { frequency: "yearly", lastReviewedAt: daysAgo(45) }
    }),
    record({
      categoryId: "banking-payments",
      serviceTemplateId: "state-bank-of-india",
      accountLabel: "SBI — joint household account",
      tags: [],
      fields: [
        { fieldKey: "account-holder", value: "Account owner" },
        { fieldKey: "account-type", value: "Joint savings account" },
        { fieldKey: "masked-account-number", value: "•••• 1190" },
        { fieldKey: "recovery-path", value: "Joint holder can operate directly; no succession needed." }
      ],
      instructions: { action: "custom", customText: "Keep active — joint holder continues using it." },
      releasePolicy: { audience: "owner_only", recipientMode: "primary", trigger: "existing_circle" },
      review: { frequency: "yearly", lastReviewedAt: daysAgo(20) }
    }),
    record({
      categoryId: "investments-wealth",
      serviceTemplateId: "zerodha",
      accountLabel: "Zerodha — equities and mutual funds",
      tags: ["investments"],
      fields: [
        { fieldKey: "account-holder", value: "Account owner" },
        { fieldKey: "customer-id", value: "Client ID on file" },
        { fieldKey: "nominee-information", value: "Nominee already registered with the broker." },
        { fieldKey: "recovery-path", value: "Transmission request with death certificate, PAN and nominee KYC." }
      ],
      instructions: { action: "transfer" },
      releasePolicy: { audience: "full_record", recipientMode: "primary", trigger: "existing_circle" },
      review: { frequency: "6_months", lastReviewedAt: daysAgo(60) }
    }),
    record({
      categoryId: "social-media",
      serviceTemplateId: "instagram",
      accountLabel: "Instagram — personal",
      tags: [],
      fields: [
        { fieldKey: "username", value: "Handle on file" },
        { fieldKey: "registered-email", value: "Linked to primary email" },
        { fieldKey: "recovery-path", value: "Platform memorialisation request with a death certificate." }
      ],
      instructions: { action: "memorialise" },
      releasePolicy: { audience: "owner_only", recipientMode: "primary", trigger: "existing_circle" },
      review: { frequency: "yearly", lastReviewedAt: daysAgo(210) }
    }),
    record({
      categoryId: "email-communication",
      serviceTemplateId: "gmail",
      accountLabel: "Gmail — primary email",
      tags: ["primary"],
      fields: [
        { fieldKey: "registered-email", value: "Primary address on file" },
        { fieldKey: "registered-phone", value: "Recovery number on file" }
      ],
      instructions: { action: "archive" },
      releasePolicy: { audience: "instructions_only", recipientMode: "primary", trigger: "existing_circle" },
      review: { frequency: "6_months", lastReviewedAt: daysAgo(15) }
    }),
    record({
      categoryId: "devices-ecosystems",
      serviceTemplateId: "apple-id",
      accountLabel: "Apple ID — household devices",
      tags: [],
      fields: [
        { fieldKey: "registered-email", value: "Apple ID email on file" },
        { fieldKey: "recovery-path", value: "Apple Digital Legacy contact, once configured on-device." }
      ],
      instructions: { action: "release_information" },
      releasePolicy: { audience: "instructions_only", recipientMode: "backup_fallback", trigger: "existing_circle" },
      review: { frequency: "6_months", lastReviewedAt: daysAgo(200) }
    }),
    record({
      categoryId: "cloud-digital-files",
      serviceTemplateId: "google-drive",
      accountLabel: "Google Drive — family archive",
      tags: ["memories"],
      fields: [
        { fieldKey: "registered-email", value: "Linked to primary email" },
        { fieldKey: "recovery-path", value: "Google Inactive Account Manager, once configured." }
      ],
      instructions: { action: "archive" },
      releasePolicy: { audience: "owner_only", recipientMode: "primary", trigger: "existing_circle" },
      review: { frequency: "yearly", lastReviewedAt: daysAgo(30) }
    }),
    record({
      categoryId: "government-identity",
      serviceTemplateId: "aadhaar",
      accountLabel: "Aadhaar",
      tags: [],
      fields: [
        { fieldKey: "account-holder", value: "Account owner" },
        { fieldKey: "document-number", value: "•••• •••• 6532" },
        { fieldKey: "recovery-path", value: "Physical document location shared with primary nominee." }
      ],
      instructions: { action: "release_information" },
      releasePolicy: { audience: "instructions_only", recipientMode: "primary", trigger: "existing_circle" },
      review: { frequency: "yearly", lastReviewedAt: daysAgo(50) }
    }),
    record({
      categoryId: "insurance",
      serviceTemplateId: "health-insurance",
      accountLabel: "Family floater health policy",
      tags: [],
      fields: [
        { fieldKey: "policy-number", value: "•••••• 7710" },
        { fieldKey: "provider-contact", value: "Insurer helpline on file" },
        { fieldKey: "renewal-date", value: "March renewal" },
        { fieldKey: "recovery-path", value: "Claim form with policy document and hospital records." }
      ],
      instructions: { action: "contact_provider" },
      releasePolicy: { audience: "instructions_only", recipientMode: "all_authorized", trigger: "existing_circle" },
      review: { frequency: "yearly", lastReviewedAt: daysAgo(400) }
    }),
    record({
      categoryId: "health-medical",
      serviceTemplateId: "emergency-health-instructions",
      accountLabel: "",
      tags: [],
      fields: [],
      instructions: {},
      releasePolicy: {},
      review: { frequency: "none" }
    }),
    record({
      categoryId: "memories-personal-archives",
      serviceTemplateId: "family-photos",
      accountLabel: "Shared family photo archive",
      tags: ["memories"],
      fields: [
        { fieldKey: "asset-location", value: "Cloud archive plus one external hard drive at home." },
        { fieldKey: "recovery-path", value: "Hard drive location shared with primary nominee." }
      ],
      instructions: { action: "transfer" },
      releasePolicy: { audience: "owner_only", recipientMode: "primary", trigger: "existing_circle" },
      review: { frequency: "yearly", lastReviewedAt: daysAgo(10) }
    }),
    record({
      categoryId: "password-managers-recovery",
      serviceTemplateId: "bitwarden",
      accountLabel: "Bitwarden — household vault",
      tags: [],
      fields: [
        { fieldKey: "registered-email", value: "Linked to primary email" }
      ],
      instructions: { action: "custom", customText: "Emergency access contact set up inside Bitwarden directly." },
      releasePolicy: { audience: "owner_only", recipientMode: "primary", trigger: "existing_circle" },
      review: { frequency: "6_months", lastReviewedAt: daysAgo(5) }
    })
  ];

  return {
    ...legacy,
    categoryReviews: [
      { categoryId: "property-physical-assets", state: "not_applicable", reviewedAt: daysAgo(45) },
      { categoryId: "shopping-travel-subscriptions", state: "not_applicable", reviewedAt: daysAgo(45) }
    ],
    records
  };
}

// Record IDs come from crypto.randomUUID() on every build, so the three
// legacy screens must share one instance for a record opened from the
// dashboard to still exist when the detail screen looks it up by ID.
let cachedSample = null;
export function getSampleDigitalLegacy() {
  if (!cachedSample) cachedSample = buildSampleDigitalLegacy();
  return cachedSample;
}
