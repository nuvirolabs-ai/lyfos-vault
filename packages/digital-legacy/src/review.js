const FREQUENCY_DAYS = Object.freeze({
  "3_months": 90,
  "6_months": 180,
  yearly: 365
});

export const DEFAULT_FRESHNESS_BANDS = Object.freeze({
  currentDays: 90,
  reviewRecommendedDays: 180,
  needsReviewDays: 365
});

function validDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date.`);
  return date;
}

export function scheduleNextReview(review = {}) {
  if (review.frequency === "none") return null;
  const days = review.frequency === "custom"
    ? Number(review.customDays)
    : FREQUENCY_DAYS[review.frequency];
  if (!Number.isFinite(days) || days <= 0 || !review.lastReviewedAt) return null;
  const next = validDate(review.lastReviewedAt, "Last reviewed date");
  next.setUTCDate(next.getUTCDate() + Math.round(days));
  return next.toISOString();
}

export function confirmRecordReview(record, { now = new Date().toISOString() } = {}) {
  const timestamp = validDate(now, "Review time").toISOString();
  const review = { ...(record.review ?? {}), lastReviewedAt: timestamp };
  return {
    ...record,
    review: {
      ...review,
      nextReviewAt: scheduleNextReview(review)
    },
    updatedAt: timestamp
  };
}

export function getFreshnessState(lastReviewedAt, { now = new Date().toISOString(), bands = DEFAULT_FRESHNESS_BANDS } = {}) {
  if (!lastReviewedAt) return { label: "potentially_outdated", value: 0, ageDays: null };
  const ageDays = Math.max(0, Math.floor((validDate(now, "Current time").getTime() - validDate(lastReviewedAt, "Last reviewed date").getTime()) / 86400000));
  if (ageDays <= bands.currentDays) return { label: "current", value: 100, ageDays };
  if (ageDays <= bands.reviewRecommendedDays) return { label: "review_recommended", value: 70, ageDays };
  if (ageDays <= bands.needsReviewDays) return { label: "needs_review", value: 35, ageDays };
  return { label: "potentially_outdated", value: 0, ageDays };
}
