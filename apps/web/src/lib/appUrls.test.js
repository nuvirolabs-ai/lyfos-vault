import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExternalAppUrl,
  normalizeReturnPath,
  requireExternalAppUrl
} from "./appUrls.js";

test("external links always use the configured canonical origin", () => {
  assert.equal(
    buildExternalAppUrl("https://app.lyfos.in/", "/invite/token-1"),
    "https://app.lyfos.in/invite/token-1"
  );
});

test("external email configuration rejects localhost and non-HTTPS origins", () => {
  assert.throws(() => requireExternalAppUrl("http://127.0.0.1:5173"), /HTTPS public app URL/);
  assert.throws(() => requireExternalAppUrl("https://[::1]:5173"), /HTTPS public app URL/);
  assert.throws(() => requireExternalAppUrl("https://127.0.0.2"), /HTTPS public app URL/);
  assert.throws(() => requireExternalAppUrl("https://0.0.0.0"), /HTTPS public app URL/);
  assert.throws(() => requireExternalAppUrl("https://[::ffff:127.0.0.1]"), /HTTPS public app URL/);
  assert.throws(() => requireExternalAppUrl("https://192.168.1.5"), /HTTPS public app URL/);
  assert.throws(() => requireExternalAppUrl("http://app.lyfos.in"), /HTTPS public app URL/);
});

test("auth return paths stay on the app and preserve invite tokens", () => {
  assert.equal(normalizeReturnPath("/invite/abc_123"), "/invite/abc_123");
  assert.equal(normalizeReturnPath("/claim/abc?step=evidence"), "/claim/abc?step=evidence");
  assert.equal(normalizeReturnPath("https://evil.example/invite/x"), "/");
  assert.equal(normalizeReturnPath("//evil.example"), "/");
});
