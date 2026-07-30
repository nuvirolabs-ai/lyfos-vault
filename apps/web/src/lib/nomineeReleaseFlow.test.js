import test from "node:test";
import assert from "node:assert/strict";

import {
  extractClaimToken,
  nomineeReleaseTimeline,
  retrieveReleaseProcessSecret,
  stashReleaseProcessKey
} from "./nomineeReleaseFlow.js";

test("extractClaimToken accepts raw tokens, claim paths, and full claim links", () => {
  assert.equal(extractClaimToken("AbC123_x-y"), "AbC123_x-y");
  assert.equal(extractClaimToken("/claim/AbC123_x-y"), "AbC123_x-y");
  assert.equal(extractClaimToken("https://app.lyfos.in/claim/AbC123_x-y?from=email"), "AbC123_x-y");
  assert.equal(extractClaimToken("https://app.lyfos.in/download"), "");
});

test("nomineeReleaseTimeline shows the owner review and key-holder sequence", () => {
  const timeline = nomineeReleaseTimeline({ state: "awaiting_shares" }, 2, new Date("2026-07-30T00:00:00Z"));

  assert.deepEqual(timeline.map((s) => [s.id, s.status]), [
    ["filed", "done"],
    ["review", "done"],
    ["keys", "active"],
    ["hold", "waiting"],
    ["download", "waiting"]
  ]);
  assert.match(timeline.find((s) => s.id === "keys").detail, /2 of 3/);
});

test("nomineeReleaseTimeline reports days left during the protection hold", () => {
  const timeline = nomineeReleaseTimeline(
    { state: "holding", ready_at: "2026-08-03T00:00:00Z" },
    3,
    new Date("2026-07-30T12:00:00Z")
  );

  const hold = timeline.find((s) => s.id === "hold");
  assert.equal(hold.status, "active");
  assert.match(hold.detail, /4 days/);
});

test("release process key is stashed by token and request id", () => {
  const storage = makeStorage();
  const keypair = { publicKey: "pub", secretKey: "secret" };

  stashReleaseProcessKey({ token: "claim-token", requestId: "request-id", keypair, storage });

  assert.equal(retrieveReleaseProcessSecret({ requestId: "request-id", storage }), "secret");
  assert.equal(retrieveReleaseProcessSecret({ token: "claim-token", storage }), "secret");
});

function makeStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); }
  };
}
