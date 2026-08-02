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

export function deriveRecordStatus(record = {}, { now = new Date().toISOString() } = {}) {
  if (record.archivedAt) return "archived";
  if (record.releasedAt) return "released";
  if (record.validationErrors?.length) return "action_required";

  const fields = Array.isArray(record.fields) ? record.fields : [];
  const identified = hasValue(record.accountLabel)
    || fields.some((field) => ["identity_information", "account_information"].includes(field.classification) && hasValue(field.value));
  const recoveryPath = fields.some((field) => field.fieldKey === "recovery-path" && hasValue(field.value));
  const actionSelected = hasValue(record.instructions?.action);
  const releaseConfigured = hasValue(record.releasePolicy?.audience);

  if (!identified && fields.length === 0) return "started";
  if (!identified || !recoveryPath || !actionSelected || !releaseConfigured) return "incomplete";
  if (reviewDue(record, now)) return "needs_review";
  if (record.releasePolicy?.audience && record.releasePolicy.audience !== "owner_only") return "scheduled_for_release";
  return "protected";
}
