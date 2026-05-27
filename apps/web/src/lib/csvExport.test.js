import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshotsCsv } from "./csvExport.js";

test("empty balance sheet produces just the header + totals", () => {
  const csv = buildSnapshotsCsv({ accounts: [], snapshots: [] });
  // No accounts, no rows — just the trailing-three totals columns.
  assert.equal(csv.trim(), "month,assets_total,liabilities_total,net_worth");
});

test("snapshots produce one CSV row per month with per-account columns", () => {
  const accounts = [
    { id: "a1", name: "HDFC savings", kind: "asset",     category: "cash" },
    { id: "a2", name: "Home loan",    kind: "liability", category: "home_loan" }
  ];
  const snapshots = [
    { month: "2026-04", values: { a1: 100000, a2: 4200000 } },
    { month: "2026-05", values: { a1: 120000, a2: 4180000 } }
  ];
  const csv = buildSnapshotsCsv({ accounts, snapshots });
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 3); // header + 2 snapshots
  assert.equal(lines[0], "month,HDFC savings (asset),Home loan (liability),assets_total,liabilities_total,net_worth");
  assert.equal(lines[1], "2026-04,100000,4200000,100000,4200000,-4100000");
  assert.equal(lines[2], "2026-05,120000,4180000,120000,4180000,-4060000");
});

test("snapshots are emitted in chronological order even if stored shuffled", () => {
  const accounts = [{ id: "a1", name: "Cash", kind: "asset", category: "cash" }];
  const snapshots = [
    { month: "2026-05", values: { a1: 200 } },
    { month: "2026-03", values: { a1: 100 } },
    { month: "2026-04", values: { a1: 150 } }
  ];
  const csv = buildSnapshotsCsv({ accounts, snapshots });
  const months = csv.trim().split("\n").slice(1).map((l) => l.split(",")[0]);
  assert.deepEqual(months, ["2026-03", "2026-04", "2026-05"]);
});

test("account names with commas and quotes are escaped", () => {
  const accounts = [
    { id: "a1", name: 'HDFC "primary", savings', kind: "asset", category: "cash" }
  ];
  const snapshots = [{ month: "2026-05", values: { a1: 100 } }];
  const csv = buildSnapshotsCsv({ accounts, snapshots });
  const header = csv.split("\n")[0];
  assert.equal(header, 'month,"HDFC ""primary"", savings (asset)",assets_total,liabilities_total,net_worth');
});

test("removed accounts (in snapshots but not in accounts) are still included", () => {
  const accounts = [{ id: "current", name: "Cash", kind: "asset", category: "cash" }];
  const snapshots = [
    { month: "2026-04", values: { current: 100, gone: 50 } },
    { month: "2026-05", values: { current: 120 } }
  ];
  const csv = buildSnapshotsCsv({ accounts, snapshots });
  const header = csv.split("\n")[0];
  assert.match(header, /gone \(removed\)/);
});

test("zero values render as empty cells to keep the CSV scannable", () => {
  const accounts = [{ id: "a1", name: "Cash", kind: "asset", category: "cash" }];
  const snapshots = [{ month: "2026-05", values: { a1: 0 } }];
  const csv = buildSnapshotsCsv({ accounts, snapshots });
  const dataRow = csv.split("\n")[1];
  // The value column for a1 should be empty: "2026-05,,0,0,0"
  assert.equal(dataRow, "2026-05,,0,0,0");
});
