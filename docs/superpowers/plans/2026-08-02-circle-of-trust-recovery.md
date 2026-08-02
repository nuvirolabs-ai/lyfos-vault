# Circle of Trust Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a locally verified Circle of Trust in which a selected primary or approved backup uses their own recovery key plus two other nominee shares to open the owner's complete vault read-only.

**Architecture:** Keep the existing React/Vite and Supabase boundaries, but replace the loosely coupled claim-link flow with an authenticated, generation-based recovery ceremony. The owner masks the vault key with a random recipient gate, splits the masked key 2-of-5, seals the gate to primary and backup, and uploads the complete generation atomically. Canonical URL construction and an observable email outbox make invite and activation delivery deterministic.

**Tech Stack:** React 19, Vite 7, Node test runner, Web Crypto, libsodium, secrets.js-grempe, Supabase Postgres/RLS/RPC/Edge Functions, Resend.

---

## File structure

**Create**

- `apps/web/src/lib/appUrls.js` — canonical public URLs and safe auth return paths.
- `apps/web/src/lib/appUrls.test.js` — URL and localhost regression tests.
- `apps/web/src/lib/recoveryCeremony.js` — pure role, state, and read-only view-model rules.
- `apps/web/src/lib/recoveryCeremony.test.js` — role, quorum, and view-model tests.
- `supabase/migrations/0021_recipient_gated_circle.sql` — roles, generations, hashed invites, recovery authorization, outbox, RLS, and atomic RPCs.
- `supabase/functions/send-auth-email/index.ts` — verified Supabase Send Email Hook routed through Resend.
- `supabase/functions/resend-webhook/index.ts` — signed idempotent delivery-event ingestion.
- `docs/circle-of-trust-local-ceremony.md` — six-account local verification runbook.

**Modify**

- `apps/web/src/lib/auth.js` and `auth.test.js` — explicit return paths and confirmation resend.
- `apps/web/src/AuthScreen.jsx` — locked invited email and resumable confirmation UX.
- `apps/web/src/lib/shareCrypto.js` and `shareCrypto.test.js` — recipient-gate masking and 2-of-5 masked shares.
- `apps/web/src/lib/releasePlan.js` and `releasePlan.test.js` — roles, atomic generations, and delivery state.
- `apps/web/src/lib/releaseClaim.js` and `releaseClaim.test.js` — authenticated relationship recovery.
- `apps/web/src/InviteAcceptScreen.jsx` — exact-route activation resume and key-version registration.
- `apps/web/src/HolderReleaseScreen.jsx` — selected-recipient support approval.
- `apps/web/src/NomineeDownloadScreen.jsx` — stable-key recovery and read-only handoff.
- `apps/web/src/main.jsx` — inline roles, guided recovery, owner note, and recovered-vault shell.
- `supabase/functions/send-key-holder-invite/index.ts` — outbox-aware canonical delivery.

## Task 1: Canonical URLs and resumable authentication

**Files:**

- Create: `apps/web/src/lib/appUrls.js`
- Create: `apps/web/src/lib/appUrls.test.js`
- Modify: `apps/web/src/lib/auth.js`
- Modify: `apps/web/src/lib/auth.test.js`
- Modify: `apps/web/src/AuthScreen.jsx`
- Modify: `apps/web/src/InviteAcceptScreen.jsx`

- [ ] **Step 1: Write failing URL tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildExternalAppUrl, normalizeReturnPath, requireExternalAppUrl } from "./appUrls.js";

test("external links always use the configured canonical origin", () => {
  assert.equal(
    buildExternalAppUrl("https://app.lyfos.in/", "/invite/token-1"),
    "https://app.lyfos.in/invite/token-1"
  );
});

test("external email configuration rejects localhost", () => {
  assert.throws(() => requireExternalAppUrl("http://127.0.0.1:5173"), /HTTPS public app URL/);
});

test("auth return paths stay on the app and preserve invite tokens", () => {
  assert.equal(normalizeReturnPath("/invite/abc_123"), "/invite/abc_123");
  assert.equal(normalizeReturnPath("https://evil.example/invite/x"), "/");
  assert.equal(normalizeReturnPath("//evil.example"), "/");
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run: `node --test apps/web/src/lib/appUrls.test.js`

Expected: FAIL because `appUrls.js` does not exist.

- [ ] **Step 3: Implement canonical URL helpers**

```js
export function normalizeReturnPath(value = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "https://app.invalid");
    return parsed.origin === "https://app.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "/";
  } catch {
    return "/";
  }
}

export function requireExternalAppUrl(value) {
  const parsed = new URL(value);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" || local) throw new Error("External email requires an HTTPS public app URL");
  return parsed.origin;
}

export function buildExternalAppUrl(appUrl, returnPath = "/") {
  return new URL(normalizeReturnPath(returnPath), `${requireExternalAppUrl(appUrl)}/`).toString();
}
```

- [ ] **Step 4: Run URL tests green**

Run: `node --test apps/web/src/lib/appUrls.test.js`

Expected: PASS.

- [ ] **Step 5: Make auth APIs accept an exact return path**

Change `signUpWithPassword`, `signInWithMagicLink`, `resetPasswordEmail`, and `getAuthEmailRedirect` to accept `returnPath`. Add:

```js
export async function resendSignupConfirmation({ email, returnPath = "/" }) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: getAuthEmailRedirect(returnPath) }
  });
  if (error) throw error;
  return data;
}
```

`getAuthEmailRedirect(returnPath)` must use `VITE_APP_URL` through `buildExternalAppUrl`, with the production constant retained only as an explicit fallback for the hosted build.

- [ ] **Step 6: Preserve invite intent in AuthScreen**

Add props `initialEmail`, `lockedEmail`, and `returnPath`. Pass `returnPath` into signup, magic-link, and resend calls; disable the email input when locked; after signup without a session show `Resend activation email` with a 60-second cooldown.

Use from `InviteAcceptScreen`:

```jsx
<AuthScreen
  initialEmail={invite.holder_email}
  lockedEmail
  returnPath={`/invite/${token}`}
  onSignedIn={(nextSession) => setSession(nextSession)}
/>
```

- [ ] **Step 7: Run focused and full web tests**

Run: `node --test apps/web/src/lib/appUrls.test.js apps/web/src/lib/auth.test.js`

Expected: PASS.

Run: `npm test -w @os-one/web`

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/appUrls.js apps/web/src/lib/appUrls.test.js apps/web/src/lib/auth.js apps/web/src/lib/auth.test.js apps/web/src/AuthScreen.jsx apps/web/src/InviteAcceptScreen.jsx
git commit -m "fix: preserve trust links through account activation"
```

## Task 2: Recipient-gated cryptographic primitives

**Files:**

- Modify: `apps/web/src/lib/shareCrypto.js`
- Modify: `apps/web/src/lib/shareCrypto.test.js`

- [ ] **Step 1: Write failing primary and backup recovery tests**

```js
test("recipient gate plus two supporting shares recovers the vault key", async () => {
  const vaultKey = randomKey();
  const recipient = await makeReleaseProcessKeypair();
  const supporters = await Promise.all([0, 1].map(() => makeReleaseProcessKeypair()));
  const plan = await createRecipientGatedPlan({
    rawVaultKey: vaultKey,
    holderPublicKeys: [recipient.publicKey, supporters[0].publicKey, supporters[1].publicKey],
    primaryPublicKey: recipient.publicKey,
    backupPublicKey: supporters[0].publicKey,
    totalShares: 3
  });
  const released = await Promise.all([1, 2].map(async (index) => {
    const opened = await openSealedShare(plan.sealedShares[index], supporters[index - 1].secretKey);
    return sealShareToPubkey(opened, recipient.publicKey);
  }));
  const recovered = await recoverRecipientGatedVaultKey({
    gateEnvelope: plan.primaryGateEnvelope,
    releasedShares: released,
    recipientSecretKey: recipient.secretKey
  });
  assert.deepEqual(Array.from(recovered), Array.from(vaultKey));
});

test("recipient gate without two shares fails", async () => {
  await assert.rejects(
    () => recoverRecipientGatedVaultKey({ gateEnvelope, releasedShares: [oneShare], recipientSecretKey }),
    /two supporting shares/
  );
});

test("the backup envelope opens the same vault key", async () => {
  const recovered = await recoverRecipientGatedVaultKey({
    gateEnvelope: plan.backupGateEnvelope,
    releasedShares: backupReleasedShares,
    recipientSecretKey: backup.secretKey
  });
  assert.deepEqual(Array.from(recovered), Array.from(vaultKey));
});
```

- [ ] **Step 2: Verify the new exports fail**

Run: `node --test apps/web/src/lib/shareCrypto.test.js`

Expected: FAIL because `createRecipientGatedPlan` and `recoverRecipientGatedVaultKey` are not exported.

- [ ] **Step 3: Implement mask, split, seal, and recover**

Add `xor32(left, right)`, call `splitVaultKey(masked, { totalShares, threshold: 2 })`, seal the random gate to primary and backup, and seal each share to its holder. Update `combineShares` to accept `{ threshold = 3 }` so recipient recovery can require exactly two without weakening legacy callers.

The exported recovery function must:

```js
export async function recoverRecipientGatedVaultKey({ gateEnvelope, releasedShares, recipientSecretKey }) {
  if (!Array.isArray(releasedShares) || releasedShares.length < 2) {
    throw new Error("need two supporting shares");
  }
  const gate = await openSealedShare(gateEnvelope, recipientSecretKey);
  const shareStrings = await Promise.all(releasedShares.slice(0, 2).map(async (sealed) => {
    const bytes = await openSealedShare(sealed, recipientSecretKey);
    return bytesToShareString(bytes);
  }));
  const masked = await combineShares(shareStrings, { threshold: 2 });
  const rawVaultKey = xor32(masked, gate);
  gate.fill(0);
  masked.fill(0);
  return rawVaultKey;
}
```

- [ ] **Step 4: Run cryptographic tests green**

Run: `node --test apps/web/src/lib/shareCrypto.test.js`

Expected: all legacy 3-of-5 tests and new recipient-gated tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/shareCrypto.js apps/web/src/lib/shareCrypto.test.js
git commit -m "feat: add recipient-gated vault key recovery"
```

## Task 3: Roles, generations, recovery requests, and outbox schema

**Files:**

- Create: `supabase/migrations/0021_recipient_gated_circle.sql`
- Create: `apps/web/src/lib/recoveryCeremony.js`
- Create: `apps/web/src/lib/recoveryCeremony.test.js`
- Modify: `apps/web/src/lib/releasePlan.js`
- Modify: `apps/web/src/lib/releasePlan.test.js`

- [ ] **Step 1: Write failing pure role and quorum tests**

```js
test("activation requires one primary one backup and five accepted nominees", () => {
  assert.equal(validateCircleForActivation(validRoster).ok, true);
  assert.match(validateCircleForActivation(validRoster.map((row) => ({ ...row, role: "trusted" }))).reason, /primary/);
});

test("support excludes the selected recipient and requires two unique nominees", () => {
  assert.equal(countValidSupport({ recipientHolderId: "p", approvals: [{ holderId: "p" }, { holderId: "a" }] }), 1);
  assert.equal(countValidSupport({ recipientHolderId: "p", approvals: [{ holderId: "a" }, { holderId: "a" }, { holderId: "b" }] }), 2);
});

test("recovered vault model exposes all records and no mutation capabilities", () => {
  const model = createRecoveredVaultViewModel({ items: [{ id: "1" }, { id: "2" }] });
  assert.equal(model.items.length, 2);
  assert.deepEqual(model.capabilities, { reveal: true, copy: true, downloadAttachments: true, mutate: false, sync: false });
});
```

- [ ] **Step 2: Verify the missing-module failure**

Run: `node --test apps/web/src/lib/recoveryCeremony.test.js`

Expected: FAIL because `recoveryCeremony.js` does not exist.

- [ ] **Step 3: Implement pure ceremony rules**

Export `CIRCLE_ROLES`, `validateCircleForActivation`, `countValidSupport`, `nextRecoveryState`, and `createRecoveredVaultViewModel`. State transitions must reject skipped stages and terminal-state mutation.

- [ ] **Step 4: Add the database migration**

The migration must:

- Add `role`, `invite_token_hash`, `invite_expires_at`, `recovery_key_version`, and `circle_generation` to `key_holders`.
- Add partial unique indexes for one active primary and one active backup per owner.
- Add `circle_generations`, `recipient_gate_envelopes`, and `email_deliveries` tables.
- Extend `key_shares` with generation and threshold 2.
- Extend `release_requests` with `recipient_holder_id`, `recipient_role`, `recipient_key_version`, `request_kind`, `instructions_ciphertext`, and the new state names.
- Replace direct recipient reads of `release_share_releases` with a policy that permits reads only at `ready_to_recover`.
- Add `activate_circle_generation(jsonb)`, `create_recovery_request(uuid,text,text)`, `release_supporting_share(uuid,text,text)`, and `get_ready_recovery_material(uuid)` security-definer RPCs.
- Enforce two unique non-recipient supporters in `release_supporting_share` and start the hold on the second valid release.
- Store invite token hashes and compare `encode(digest(p_token, 'sha256'), 'hex')` in invite RPCs.

- [ ] **Step 5: Update releasePlan client contracts**

`createKeyHolderInvite` accepts `role`; `finalizeReleasePlan` becomes `activateCircleGeneration` and invokes the atomic RPC with all five sealed shares, both gate envelopes, both encrypted instruction envelopes, and key versions.

- [ ] **Step 6: Run focused tests**

Run: `node --test apps/web/src/lib/recoveryCeremony.test.js apps/web/src/lib/releasePlan.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0021_recipient_gated_circle.sql apps/web/src/lib/recoveryCeremony.js apps/web/src/lib/recoveryCeremony.test.js apps/web/src/lib/releasePlan.js apps/web/src/lib/releasePlan.test.js
git commit -m "feat: model recipient-gated trust ceremonies"
```

## Task 4: Observable invitation and auth email delivery

**Files:**

- Modify: `supabase/functions/send-key-holder-invite/index.ts`
- Create: `supabase/functions/send-auth-email/index.ts`
- Create: `supabase/functions/resend-webhook/index.ts`
- Modify: `apps/web/src/lib/releasePlan.js`

- [ ] **Step 1: Extract and test delivery-state reduction**

Put the event-to-state mapping in `recoveryCeremony.js` and test:

```js
test("delivery events distinguish sent delivered delayed and bounced", () => {
  assert.equal(reduceDeliveryState("queued", "email.sent"), "sent");
  assert.equal(reduceDeliveryState("sent", "email.delivered"), "delivered");
  assert.equal(reduceDeliveryState("sent", "email.delivery_delayed"), "delayed");
  assert.equal(reduceDeliveryState("delivered", "email.bounced"), "bounced");
});
```

- [ ] **Step 2: Make invite sending consume an outbox delivery**

The function receives `delivery_id`, verifies owner authorization through the related invite, claims only `queued` or retryable rows, sends a canonical invite URL using `APP_URL`, supplies the delivery id as a Resend tag/idempotency value, stores the provider id, and returns `{ ok: true, state: "sent" }`. It must never return `delivered: true` from the send response.

- [ ] **Step 3: Add the Supabase Auth Send Email Hook**

Verify the Standard Webhooks signature with `SEND_EMAIL_HOOK_SECRET`, render the supplied confirmation action link without changing its allowlisted redirect, send through Resend, and return the hook response expected by Supabase. Secrets are `RESEND_API_KEY`, `FROM_EMAIL`, and `SEND_EMAIL_HOOK_SECRET`.

- [ ] **Step 4: Add the Resend webhook**

Verify `svix-id`, `svix-timestamp`, and `svix-signature` with `RESEND_WEBHOOK_SECRET`; insert the event id once; update the matching provider message id using the pure delivery-state mapping; return 200 for already-seen events.

- [ ] **Step 5: Update owner feedback**

`sendInviteEmail` returns delivery state and the UI renders `Queued`, `Sent`, `Delivered`, `Delayed`, `Bounced`, `Suppressed`, or `Failed`. Manual copy and WhatsApp links use `buildExternalAppUrl`.

- [ ] **Step 6: Run tests and TypeScript parsing checks**

Run: `npm test -w @os-one/web`

Expected: PASS.

Run: `supabase functions serve send-key-holder-invite send-auth-email resend-webhook --env-file supabase/functions/.env.local`

Expected: functions start locally; signed fixture requests return the expected status. Stop the server after fixtures complete.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/send-key-holder-invite/index.ts supabase/functions/send-auth-email/index.ts supabase/functions/resend-webhook/index.ts apps/web/src/lib/releasePlan.js apps/web/src/lib/recoveryCeremony.js apps/web/src/lib/recoveryCeremony.test.js
git commit -m "feat: expose real trust email delivery state"
```

## Task 5: Inline primary and backup setup with atomic activation

**Files:**

- Modify: `apps/web/src/main.jsx`
- Modify: `apps/web/src/lib/releasePlan.js`
- Modify: `apps/web/src/lib/releasePlan.test.js`

- [ ] **Step 1: Add failing roster tests for role labels and readiness**

```js
test("roster slots expose primary and backup roles", () => {
  const slots = buildTrustRosterSlots([
    { id: "1", role: "primary", label: "Priya", holder_email: "p@example.com", status: "accepted", release_pubkey: "pk" },
    { id: "2", role: "backup", label: "Ravi", holder_email: "r@example.com", status: "accepted", release_pubkey: "pk" }
  ]);
  assert.equal(slots[0].roleLabel, "Primary");
  assert.equal(slots[1].roleLabel, "Backup");
});
```

- [ ] **Step 2: Verify the role-label failure**

Run: `node --test apps/web/src/lib/releasePlan.test.js`

Expected: FAIL because `roleLabel` is missing.

- [ ] **Step 3: Add role selection to the inline invite form**

Render a three-option segmented control with `Primary`, `Backup`, and `Trusted`. Disable a role already occupied by another active invite. Submit `{ label, holderEmail, holderPhone, role }` in the existing single compact form.

- [ ] **Step 4: Build and activate a complete generation**

On finalize, export the raw vault key, call `createRecipientGatedPlan`, encrypt the personal note to primary and backup, and call `activateCircleGeneration`. Clear all mutable raw buffers in `finally`. Show one confirmation listing all five people and role pills.

- [ ] **Step 5: Enforce reseal framing**

If any accepted nominee role, public-key version, or membership differs from the active generation, display `Circle needs re-sealing` and offer one unlock-dependent action. Do not expose partial share-management controls.

- [ ] **Step 6: Run tests and build**

Run: `npm test -w @os-one/web && npm run build -w @os-one/web`

Expected: PASS; Vite build completes.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/main.jsx apps/web/src/lib/releasePlan.js apps/web/src/lib/releasePlan.test.js
git commit -m "feat: select trust recipients and activate atomically"
```

## Task 6: Guided primary and backup recovery

**Files:**

- Modify: `apps/web/src/lib/releaseClaim.js`
- Modify: `apps/web/src/lib/releaseClaim.test.js`
- Modify: `apps/web/src/ClaimScreen.jsx`
- Modify: `apps/web/src/HolderReleaseScreen.jsx`
- Modify: `apps/web/src/NomineeDownloadScreen.jsx`

- [ ] **Step 1: Write failing relationship and recovery-state tests**

```js
test("only primary starts normal recovery and backup starts fallback recovery", () => {
  assert.equal(canStartRecovery({ role: "primary", kind: "normal" }), true);
  assert.equal(canStartRecovery({ role: "backup", kind: "normal" }), false);
  assert.equal(canStartRecovery({ role: "backup", kind: "backup" }), true);
});

test("support page excludes the selected recipient", () => {
  assert.equal(canSupportRecovery({ holderId: "p", recipientHolderId: "p", state: "collecting_support" }), false);
  assert.equal(canSupportRecovery({ holderId: "a", recipientHolderId: "p", state: "collecting_support" }), true);
});
```

- [ ] **Step 2: Verify tests fail on missing ceremony rules**

Run: `node --test apps/web/src/lib/recoveryCeremony.test.js apps/web/src/lib/releaseClaim.test.js`

Expected: FAIL on missing `canStartRecovery` or `canSupportRecovery`.

- [ ] **Step 3: Replace claim-token client APIs**

Add `listVaultsEntrustedToMe`, `createRelationshipRecoveryRequest`, `listRecoveryRequestsForMe`, `submitRecoveryEvidence`, and `getReadyRecoveryMaterial`. Every API uses authenticated relationship ids; no email-only or public claim token can authorize a request.

- [ ] **Step 4: Build the guided recovery page**

Use the existing narrow `ClaimScreen` shell to render one current stage: process explanation, fixed checklist plus decrypted owner note, evidence submission, review, support collection, hold, and recovery. Backup mode begins with unavailable-primary reason and evidence.

- [ ] **Step 5: Update supporting nominee release**

Load the selected recipient's stable public key from request context. Derive the supporter's stable private key, open their generation share, re-encrypt it to the selected recipient, and submit through `release_supporting_share`. Show approve and refuse as separate deliberate actions.

- [ ] **Step 6: Replace sessionStorage recovery**

Remove `makeReleaseProcessKeypair`, `stashReleaseProcessKey`, and `retrieveReleaseProcessSecret` from the active recovery path. At `ready_to_recover`, derive the selected recipient key from their passphrase, fetch two released shares and the matching gate envelope, then call `recoverRecipientGatedVaultKey`.

- [ ] **Step 7: Run tests and build**

Run: `npm test -w @os-one/web && npm run build -w @os-one/web`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/recoveryCeremony.js apps/web/src/lib/recoveryCeremony.test.js apps/web/src/lib/releaseClaim.js apps/web/src/lib/releaseClaim.test.js apps/web/src/ClaimScreen.jsx apps/web/src/HolderReleaseScreen.jsx apps/web/src/NomineeDownloadScreen.jsx
git commit -m "feat: guide primary and backup vault recovery"
```

## Task 7: Entire-vault read-only recovery shell and instructions

**Files:**

- Modify: `apps/web/src/main.jsx`
- Modify: `apps/web/src/NomineeDownloadScreen.jsx`
- Modify: `apps/web/src/lib/recoveryCeremony.js`
- Modify: `apps/web/src/lib/recoveryCeremony.test.js`

- [ ] **Step 1: Write failing read-only capability tests**

```js
test("recovered vault includes non-emergency records", () => {
  const model = createRecoveredVaultViewModel({
    items: [{ id: "1", emergencyEligible: true }, { id: "2", emergencyEligible: false }]
  });
  assert.deepEqual(model.items.map((item) => item.id), ["1", "2"]);
});

test("recovered vault never exposes mutation or owner-account actions", () => {
  const model = createRecoveredVaultViewModel({ items: [] });
  assert.equal(model.capabilities.mutate, false);
  assert.equal(model.capabilities.sync, false);
  assert.equal(model.capabilities.ownerSettings, false);
});
```

- [ ] **Step 2: Verify the capability failure**

Run: `node --test apps/web/src/lib/recoveryCeremony.test.js`

Expected: FAIL until the exact capability model exists.

- [ ] **Step 3: Implement a dedicated recovered shell**

Render `Recovered · Read only` persistently, pin emergency-instruction records, preserve category navigation and search, and reuse intentional reveal and attachment-view components. Do not pass save callbacks, billing navigation, device controls, owner settings, record editor, delete handlers, or cloud-sync effects into this shell.

- [ ] **Step 4: Add automatic relocking**

Keep the imported vault key and decrypted vault only in component memory. Apply the existing inactivity and visibility lock policies. Reopen by deriving the recipient key again and re-running ready recovery material decryption.

- [ ] **Step 5: Run tests and build**

Run: `npm test -w @os-one/web && npm run build -w @os-one/web`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/main.jsx apps/web/src/NomineeDownloadScreen.jsx apps/web/src/lib/recoveryCeremony.js apps/web/src/lib/recoveryCeremony.test.js
git commit -m "feat: open recovered vault in a read-only shell"
```

## Task 8: Local ceremony, regression verification, and deployment gate

**Files:**

- Create: `docs/circle-of-trust-local-ceremony.md`
- Modify: `SELF_HOSTING.md`

- [ ] **Step 1: Document the local six-account ceremony**

Specify local Supabase startup, local mailbox URLs, owner plus five deterministic test identities, test vault fixture, invite acceptance, activation, primary request, two supports, controlled hold advancement, read-only recovery, backup fallback, abort, rejection, resend, and role rotation.

- [ ] **Step 2: Add environment preflight instructions**

Document that connected external sending requires matching `VITE_APP_URL` and `APP_URL`, HTTPS, Supabase redirect allowlisting, configured Send Email Hook, verified Resend domain, and signed webhook secret. State that provider webhook registration and live-email testing require separate approval.

- [ ] **Step 3: Run the complete local suite**

Run:

```bash
npm test -w @os-one/web
npm run build -w @os-one/web
npm run check
git diff --check
```

Expected: every command exits 0 with no new warnings beyond the existing Vite browser-crypto externalization notice.

- [ ] **Step 4: Run database tests locally**

Run:

```bash
supabase start
supabase db reset
supabase test db
```

Expected: migration applies from a clean database and all role, RLS, RPC, token, state, and hold tests PASS.

- [ ] **Step 5: Execute the browser ceremony**

Use local Supabase and local mail capture only. Record pass/fail evidence for the full primary and backup paths and every negative acceptance criterion. Do not use production credentials or real vault data.

- [ ] **Step 6: Confirm production remains untouched**

Run: `git status --short`, `supabase migration list`, and `vercel ls lyfos-vault` as read-only checks.

Expected: local working tree state is understood; no new production deployment or remote migration appears.

- [ ] **Step 7: Commit documentation**

```bash
git add docs/circle-of-trust-local-ceremony.md SELF_HOSTING.md
git commit -m "docs: add local trust ceremony verification"
```

## Completion gate

Do not deploy, push, repair remote migration history, register live webhooks, or run live-email tests during this plan. Completion means local code, migrations, functions, tests, build, and six-account ceremony are green, followed by a separate review before any staging authorization.
