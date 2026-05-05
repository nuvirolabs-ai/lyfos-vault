import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(here, "../main.jsx"), "utf8");

test("entry copy does not imply real nominee execution or owner-alert service in private beta", () => {
  for (const forbidden of [
    "Nominee plus key holders.",
    "14 days of owner alerts."
  ]) {
    assert.equal(mainSource.includes(forbidden), false, `entry copy still includes: ${forbidden}`);
  }
});

test("release copy states the current service boundary honestly", () => {
  assert.equal(mainSource.includes("does not yet send emails, verify nominees, run a 14-day timer, or open records for another person"), true);
});
