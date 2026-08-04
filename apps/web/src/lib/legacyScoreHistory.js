// A small local-only history of the Digital Legacy score, one snapshot
// per day, so the home screen can show a trend ("+4 this week") and a
// quiet sparkline instead of just a bare, unexplained number. Nothing
// here syncs anywhere — it's derived data, safe to lose or rebuild.
const STORAGE_KEY = "os-one.legacy.score-history.v1";
const MAX_DAYS = 90;
const TREND_WINDOW_DAYS = 7;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function loadScoreHistory(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Records today's score once per day (overwrites if called again the
// same day, so re-renders don't pile up duplicate entries).
export function recordScoreSnapshot(score, storage = globalThis.localStorage, now = new Date()) {
  const today = isoDate(now);
  const history = loadScoreHistory(storage);
  const next = [...history.filter((entry) => entry.date !== today), { date: today, score }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_DAYS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable — the trend/sparkline just won't have
    // today's point yet; nothing else depends on this write succeeding.
  }
  return next;
}

// Delta vs. the closest snapshot at or before `windowDays` ago. Returns
// null (not 0) when there isn't enough history yet — a badge that only
// ever reads "+0" is worse than no badge at all.
export function getWeeklyTrend(history, currentScore, now = new Date(), windowDays = TREND_WINDOW_DAYS) {
  if (!history.length) return null;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffIso = isoDate(cutoff);
  const past = history.filter((entry) => entry.date <= cutoffIso).at(-1);
  if (!past) return null;
  return currentScore - past.score;
}
