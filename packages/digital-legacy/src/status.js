function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function reviewDue(record, now) {
  const next = record?.review?.nextReviewAt;
  if (next) return new Date(next).getTime() <= new Date(now).getTime();
  const last = record?.review?.lastReviewedAt;
  const frequency = record?.review?.frequency;
  if (!last || frequency === "none") return false;
  const days = { "3_months": 90, "6_months": 180, yearly: 365 }[frequency]
    ?? Number(record?.review?.customDays || 0);
  return days > 0 && new Date(last).getTime() + (days * 86400000) <= new Date(now).getTime();
}

// The one mandatory bar for a record to stop being flagged: does it say
// what it's for? Recovery paths, a chosen legacy action, and a release
// plan all make a record richer (reflected in the readiness score,
// score.js) but most accounts will legitimately never have all of
// them filled in, and that's fine — they shouldn't perpetually nag
// "complete the missing details" once the record actually identifies
// something real.
export function deriveRecordStatus(record = {}, { now = new Date().toISOString() } = {}) {
  if (record.archivedAt) return "archived";
  if (record.releasedAt) return "released";
  if (record.validationErrors?.length) return "action_required";

  const fields = Array.isArray(record.fields) ? record.fields : [];
  const identified = hasValue(record.accountLabel)
    || fields.some((field) => ["identity_information", "account_information"].includes(field.classification) && hasValue(field.value));

  if (!identified) return fields.length === 0 ? "started" : "incomplete";
  if (reviewDue(record, now)) return "needs_review";
  if (record.releasePolicy?.audience && record.releasePolicy.audience !== "owner_only") return "scheduled_for_release";
  return "protected";
}

// Status is computed once and stored on the record at save time, not
// recomputed on every read — so records saved before a status-logic
// change (like the one above) keep their stale value until something
// touches them. Called once on vault unlock to bring existing records
// in line with the current rules, without requiring the owner to
// manually re-open and re-save each one. Only returns a new object
// (and only the records that actually changed) when something's
// status actually moved, so an unlock with nothing stale to fix is a
// no-op — no needless re-save, no needless cloud push.
export function refreshDigitalLegacyStatuses(digitalLegacy, { now = new Date().toISOString() } = {}) {
  const records = digitalLegacy?.records ?? [];
  let changed = false;
  const nextRecords = records.map((record) => {
    const status = deriveRecordStatus(record, { now });
    if (status === record.status) return record;
    changed = true;
    return { ...record, status };
  });
  if (!changed) return { digitalLegacy, changed: false };
  return { digitalLegacy: { ...digitalLegacy, records: nextRecords }, changed: true };
}
