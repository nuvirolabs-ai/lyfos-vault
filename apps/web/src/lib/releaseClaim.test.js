import test from "node:test";
import assert from "node:assert/strict";
import { isValidNomineeEmail } from "./releaseValidation.js";

test("nominee email validation rejects empty and malformed values", () => {
  assert.equal(isValidNomineeEmail(""), false);
  assert.equal(isValidNomineeEmail("person@example"), false);
  assert.equal(isValidNomineeEmail("person example.com"), false);
});

test("nominee email validation accepts a normal address", () => {
  assert.equal(isValidNomineeEmail("priya@example.com"), true);
  assert.equal(isValidNomineeEmail(" PRIYA@EXAMPLE.COM "), true);
});
