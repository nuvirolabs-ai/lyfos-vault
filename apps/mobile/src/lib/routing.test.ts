// Run: node --import tsx --test src/lib/routing.test.ts
// (pure logic; no RN runtime needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextRoute, RouteState } from "./routing";

const base: RouteState = {
  sessionLoaded: true,
  supabaseConfigured: true,
  hasSession: false,
  hasStoredRecord: false,
  unlocked: false,
  first: ""
};

test("waits while session is still loading", () => {
  assert.equal(nextRoute({ ...base, sessionLoaded: false }), null);
});

test("public routes are never redirected", () => {
  for (const first of ["invite", "claim", "release", "hold-release", "download", "admin", "auth"]) {
    assert.equal(nextRoute({ ...base, first }), null);
  }
});

test("LOCAL-ONLY fresh install routes to create (the Unmatched Route bug)", () => {
  // No Supabase, no session, no record — must reach create, not dead-end.
  assert.equal(
    nextRoute({ ...base, supabaseConfigured: false, hasSession: false, hasStoredRecord: false, first: "" }),
    "/(entry)/create"
  );
});

test("local-only with a stored vault routes to unlock", () => {
  assert.equal(
    nextRoute({ ...base, supabaseConfigured: false, hasStoredRecord: true, unlocked: false, first: "" }),
    "/(entry)/unlock"
  );
});

test("local-only unlocked enters the app", () => {
  assert.equal(
    nextRoute({ ...base, supabaseConfigured: false, hasStoredRecord: true, unlocked: true, first: "" }),
    "/(tabs)/home"
  );
});

test("configured + no session + no record → sign-in", () => {
  assert.equal(nextRoute({ ...base, supabaseConfigured: true, hasSession: false }), "/(auth)/sign-in");
});

test("configured + session + no record → create", () => {
  assert.equal(nextRoute({ ...base, supabaseConfigured: true, hasSession: true }), "/(entry)/create");
});

test("configured + has record + sealed → unlock (even without session)", () => {
  assert.equal(
    nextRoute({ ...base, supabaseConfigured: true, hasSession: false, hasStoredRecord: true }),
    "/(entry)/unlock"
  );
});

test("no redundant redirect when already on the right screen", () => {
  assert.equal(nextRoute({ ...base, supabaseConfigured: false, first: "(entry)" }), null);
  assert.equal(nextRoute({ ...base, hasStoredRecord: true, first: "(entry)" }), null);
  assert.equal(nextRoute({ ...base, hasSession: false, first: "(auth)" }), null);
});

test("EXHAUSTIVE: every reachable state has a destination (no dead-ends)", () => {
  for (const supabaseConfigured of [true, false]) {
    for (const hasSession of [true, false]) {
      for (const hasStoredRecord of [true, false]) {
        for (const unlocked of [true, false]) {
          // session implies configured; unlocked implies a stored record
          if (hasSession && !supabaseConfigured) continue;
          if (unlocked && !hasStoredRecord) continue;
          const r = nextRoute({ ...base, supabaseConfigured, hasSession, hasStoredRecord, unlocked, first: "" });
          assert.ok(r !== null, `dead-end at cfg=${supabaseConfigured} sess=${hasSession} rec=${hasStoredRecord} unlk=${unlocked}`);
        }
      }
    }
  }
});
