import test from "node:test";
import assert from "node:assert/strict";
import { getBalanceSheetSummary } from "./balanceSheet.js";

test("balance summary totals assets, liabilities, and net worth", () => {
  const summary = getBalanceSheetSummary({
    accounts: [
      { id: "cash", kind: "asset" },
      { id: "loan", kind: "liability" }
    ],
    snapshots: [{ month: "2026-07", values: { cash: 500000, loan: 200000 } }]
  });
  assert.deepEqual({ assets: summary.assets, liabilities: summary.liabilities, netWorth: summary.netWorth }, { assets: 500000, liabilities: 200000, netWorth: 300000 });
  assert.equal(summary.accountCount, 2);
});

test("balance summary is neutral without enough history", () => {
  const summary = getBalanceSheetSummary({ accounts: [{ id: "cash", kind: "asset" }], snapshots: [] });
  assert.equal(summary.direction, "neutral");
});

test("balance summary flags rising liabilities or falling net worth", () => {
  const summary = getBalanceSheetSummary({
    accounts: [{ id: "cash", kind: "asset" }, { id: "loan", kind: "liability" }],
    snapshots: [
      { month: "2026-06", values: { cash: 500000, loan: 100000 } },
      { month: "2026-07", values: { cash: 490000, loan: 150000 } }
    ]
  });
  assert.equal(summary.direction, "watch");
});
