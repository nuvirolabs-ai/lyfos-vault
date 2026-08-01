import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(resolve(here, "../main.jsx"), "utf8");

test("entry copy does not imply real nominee execution or owner-alert service in product", () => {
  for (const forbidden of [
    "Nominee plus key holders.",
    "14 days of owner alerts."
  ]) {
    assert.equal(mainSource.includes(forbidden), false, `entry copy still includes: ${forbidden}`);
  }
});

test("release copy states the current service boundary honestly", () => {
  // Three accepted framings — earliest was the Phase 0 prototype copy;
  // Phase 1 replaced it with "yet contact your nominees"; Phase 3 once
  // the real engine ships labels the local-only deploy as "Planning
  // mode only" with the cloud path explained. Any one of these in
  // main.jsx means the user is told plainly when the live release
  // service is and isn't running.
  const oldFraming = mainSource.includes("does not yet send emails, verify nominees, run a 14-day timer, or open records for another person");
  const midFraming = ["Lyfos does", "not", "yet contact your nominees"].every((fragment) => mainSource.includes(fragment));
  const newFraming = mainSource.includes("Planning mode only");
  assert.equal(oldFraming || midFraming || newFraming, true, "main.jsx should explicitly tell users when the release service is and isn't active");
});
