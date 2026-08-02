import test from "node:test";
import assert from "node:assert/strict";

import { getAuthEmailRedirect } from "./auth.js";

test("auth email redirects use production and preserve a safe return path", () => {
  assert.equal(getAuthEmailRedirect(), "https://app.lyfos.in/");
  assert.equal(getAuthEmailRedirect("/invite/abc_123"), "https://app.lyfos.in/invite/abc_123");
  assert.equal(getAuthEmailRedirect("//evil.example"), "https://app.lyfos.in/");
});
