import test from "node:test";
import assert from "node:assert/strict";
import { getWeeklyTrend, loadScoreHistory, recordScoreSnapshot } from "./legacyScoreHistory.js";
import { createMemoryStorage } from "./stage1Store.js";

test("score snapshots are one per day, sorted, and capped", () => {
  const storage = createMemoryStorage();
  recordScoreSnapshot(10, storage, new Date("2026-08-01T09:00:00.000Z"));
  recordScoreSnapshot(15, storage, new Date("2026-08-01T18:00:00.000Z"));
  recordScoreSnapshot(20, storage, new Date("2026-08-02T09:00:00.000Z"));

  const history = loadScoreHistory(storage);
  assert.deepEqual(history, [
    { date: "2026-08-01", score: 15 },
    { date: "2026-08-02", score: 20 }
  ]);
});

test("weekly trend compares against the closest snapshot at or before 7 days ago", () => {
  const storage = createMemoryStorage();
  recordScoreSnapshot(10, storage, new Date("2026-07-25T00:00:00.000Z"));
  recordScoreSnapshot(18, storage, new Date("2026-07-29T00:00:00.000Z"));
  const history = loadScoreHistory(storage);

  const trend = getWeeklyTrend(history, 26, new Date("2026-08-01T00:00:00.000Z"));
  assert.equal(trend, 16);
});

test("weekly trend is null (not zero) when there isn't a week of history yet", () => {
  const storage = createMemoryStorage();
  recordScoreSnapshot(10, storage, new Date("2026-08-01T00:00:00.000Z"));
  const history = loadScoreHistory(storage);

  assert.equal(getWeeklyTrend(history, 10, new Date("2026-08-02T00:00:00.000Z")), null);
  assert.equal(getWeeklyTrend([], 10), null);
});
