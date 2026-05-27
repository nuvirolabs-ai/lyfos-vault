import test from "node:test";
import assert from "node:assert/strict";
import { formatCurrency, formatCompact, currencySymbol, getCurrency } from "./currency.js";

test("INR uses lakh + crore compact units", () => {
  assert.equal(formatCompact(8432150, "INR"),     "₹84.3 L");
  assert.equal(formatCompact(125000000, "INR"),   "₹12.50 Cr");
  assert.equal(formatCompact(8500, "INR"),        "₹9k");
});

test("USD uses Western k/M/B units", () => {
  assert.equal(formatCompact(8432150, "USD"),    "$8.4M");
  assert.equal(formatCompact(125000000, "USD"),  "$125.0M");
  assert.equal(formatCompact(2300000000, "USD"), "$2.30B");
});

test("formatCurrency uses locale-appropriate digit grouping", () => {
  assert.equal(formatCurrency(8432150, "INR"), "₹84,32,150"); // Indian lakh/crore grouping
  assert.equal(formatCurrency(8432150, "USD"), "$8,432,150");
});

test("negative values get the minus sign before the symbol", () => {
  assert.equal(formatCurrency(-1000, "INR"), "−₹1,000");
  assert.equal(formatCompact(-1500, "INR"),  "−₹2k");
});

test("unknown currency falls back to INR", () => {
  assert.equal(currencySymbol("XYZ"), "₹");
  assert.equal(getCurrency("XYZ").code, "INR");
});

test("zero is rendered without sign", () => {
  assert.equal(formatCurrency(0, "INR"), "₹0");
  assert.equal(formatCompact(0, "INR"), "₹0");
});
