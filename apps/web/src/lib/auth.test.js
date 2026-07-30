import test from "node:test";
import assert from "node:assert/strict";

import { getAuthEmailRedirect } from "./auth.js";

test("auth email redirects always use the production app URL", () => {
  assert.equal(getAuthEmailRedirect("https://app.lyfos.in"), "https://app.lyfos.in/");
  assert.equal(getAuthEmailRedirect("http://localhost:52906"), "https://app.lyfos.in/");
  assert.equal(getAuthEmailRedirect("https://lyfos-vault-preview.vercel.app"), "https://app.lyfos.in/");
});
