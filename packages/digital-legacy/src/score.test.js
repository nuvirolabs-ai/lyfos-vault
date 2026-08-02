import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateCoverageScore,
  calculateDigitalLegacyScore,
  calculateFreshnessScore,
  calculateReadinessScore,
  confirmRecordReview,
  createPriorityActions,
  getPreparationLabel,
  scheduleNextReview,
  searchLegacyRecords
} from "./index.js";

const NOW = "2026-08-02T00:00:00.000Z";

function record(overrides = {}) {
  return {
    id: "record-1",
    categoryId: "banking-payments",
    serviceTemplateId: "state-bank-of-india",
    accountLabel: "Family savings",
    tags: ["important"],
    fields: [
      { fieldKey: "masked-account-number", classification: "account_information", value: "•••• 4821" },
      { fieldKey: "recovery-path", classification: "personal_instruction", value: "Visit the home branch." }
    ],
    instructions: { action: "contact_provider", customText: "Private sentence that is not searchable." },
    releasePolicy: { audience: "instructions_only", recipientMode: "primary", nomineeHolderIds: [], trigger: "existing_circle", enforcement: "intent_only" },
    review: { frequency: "6_months", lastReviewedAt: NOW },
    attachments: [{ id: "proof" }],
    status: "protected",
    updatedAt: NOW,
    ...overrides
  };
}

test("coverage counts categories with records or explicit not-applicable review", () => {
  const score = calculateCoverageScore({
    records: [record()],
    categoryReviews: [
      { categoryId: "social-media", state: "not_applicable", reviewedAt: NOW },
      { categoryId: "insurance", state: "reviewed", reviewedAt: NOW }
    ]
  });
  assert.equal(score.reviewedCategories, 3);
  assert.equal(score.totalCategories, 14);
  assert.equal(score.value, 21);
});

test("readiness follows 15/20/20/20/10/15 weights and never requires a password", () => {
  const ready = calculateReadinessScore([record()]);
  assert.equal(ready.value, 100);
  assert.equal(ready.records[0].criteria.authenticationSecret, undefined);

  const noNomineeOrAttachment = calculateReadinessScore([record({
    releasePolicy: { audience: "owner_only", recipientMode: "primary", nomineeHolderIds: [], trigger: "manual", enforcement: "intent_only" },
    attachments: []
  })]);
  assert.equal(noNomineeOrAttachment.value, 70);
});

test("freshness uses configurable current, review, stale and outdated bands", () => {
  const result = calculateFreshnessScore([
    record({ id: "current", review: { frequency: "yearly", lastReviewedAt: "2026-07-20T00:00:00.000Z" } }),
    record({ id: "review", review: { frequency: "yearly", lastReviewedAt: "2026-04-01T00:00:00.000Z" } }),
    record({ id: "stale", review: { frequency: "yearly", lastReviewedAt: "2026-01-01T00:00:00.000Z" } }),
    record({ id: "outdated", review: { frequency: "yearly", lastReviewedAt: "2025-01-01T00:00:00.000Z" } })
  ], { now: NOW });
  assert.deepEqual(result.records.map((item) => item.label), ["current", "review_recommended", "needs_review", "potentially_outdated"]);
  assert.equal(result.value, 51);
});

test("overall score is 40 percent coverage, 40 percent readiness and 20 percent freshness", () => {
  const result = calculateDigitalLegacyScore({
    records: [record()],
    categoryReviews: Array.from({ length: 13 }, (_, index) => ({
      categoryId: [
        "investments-wealth", "social-media", "email-communication", "devices-ecosystems",
        "cloud-digital-files", "government-identity", "insurance", "property-physical-assets",
        "business-professional", "shopping-travel-subscriptions", "health-medical",
        "memories-personal-archives", "password-managers-recovery"
      ][index],
      state: "not_applicable",
      reviewedAt: NOW
    }))
  }, { now: NOW });
  assert.deepEqual({ overall: result.overall, coverage: result.coverage.value, readiness: result.readiness.value, freshness: result.freshness.value }, {
    overall: 100,
    coverage: 100,
    readiness: 100,
    freshness: 100
  });
  assert.equal(result.label, "Strongly prepared");
});

test("preparation labels avoid security guarantees", () => {
  assert.equal(getPreparationLabel(0), "Not started");
  assert.equal(getPreparationLabel(20), "Early preparation");
  assert.equal(getPreparationLabel(50), "Partially prepared");
  assert.equal(getPreparationLabel(75), "Well prepared");
  assert.equal(getPreparationLabel(90), "Strongly prepared");
});

test("review scheduling and confirmation do not require revealing record fields", () => {
  assert.equal(scheduleNextReview({ frequency: "3_months", lastReviewedAt: NOW }), "2026-10-31T00:00:00.000Z");
  assert.equal(scheduleNextReview({ frequency: "custom", customDays: 30, lastReviewedAt: NOW }), "2026-09-01T00:00:00.000Z");
  assert.equal(scheduleNextReview({ frequency: "none", lastReviewedAt: NOW }), null);

  const original = record();
  const confirmed = confirmRecordReview(original, { now: "2026-09-01T00:00:00.000Z" });
  assert.equal(confirmed.review.lastReviewedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(confirmed.fields, original.fields);
});

test("record search uses only approved metadata and service aliases", () => {
  const records = [record()];
  assert.equal(searchLegacyRecords(records, "SBI").length, 1);
  assert.equal(searchLegacyRecords(records, "Family savings").length, 1);
  assert.equal(searchLegacyRecords(records, "important").length, 1);
  assert.equal(searchLegacyRecords(records, "4821").length, 0);
  assert.equal(searchLegacyRecords(records, "home branch").length, 0);
  assert.equal(searchLegacyRecords(records, "Private sentence").length, 0);
});

test("custom service names and aliases are searchable without indexing custom field values", () => {
  const custom = record({
    id: "custom-record",
    categoryId: "custom",
    serviceTemplateId: undefined,
    customServiceId: "custom-service-partnership",
    fields: [{ fieldKey: "custom-field-contact", classification: "account_information", value: "Unsearchable adviser" }]
  });
  const options = {
    customServices: [{ id: "custom-service-partnership", name: "Private partnership", aliases: ["Venture"] }]
  };
  assert.equal(searchLegacyRecords([custom], "partnership", options).length, 1);
  assert.equal(searchLegacyRecords([custom], "venture", options).length, 1);
  assert.equal(searchLegacyRecords([custom], "Unsearchable adviser", options).length, 0);
});

test("priority actions are stable, calm and capped at three", () => {
  const actions = createPriorityActions([
    record({ id: "a", status: "action_required", accountLabel: "Critical" }),
    record({ id: "b", status: "incomplete", accountLabel: "Incomplete" }),
    record({ id: "c", status: "needs_review", accountLabel: "Review" }),
    record({ id: "d", status: "incomplete", accountLabel: "Fourth" })
  ]);
  assert.equal(actions.length, 3);
  assert.deepEqual(actions.map((action) => action.recordId), ["a", "b", "d"]);
  assert.ok(actions.every((action) => !/secure|safe|guarantee/i.test(action.message)));
});
