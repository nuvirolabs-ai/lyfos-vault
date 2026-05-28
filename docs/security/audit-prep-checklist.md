# Pre-Audit Checklist (give this to the auditor on day 1)

We engage an independent firm for a paid security audit before public launch.
Budget: ₹2,00,000 (capped). Target firms (India, with appsec + crypto chops):

| Firm                | Strength               | Approx. cost | Notes                                |
|---------------------|------------------------|--------------|--------------------------------------|
| Block Harbor        | Crypto + protocol      | ₹1.5-2.5L    | Good for our SSS + X25519 work       |
| Astra Security      | Webapp pen-test        | ₹0.8-1.5L    | OWASP-style; weaker on crypto        |
| Payatu              | Mobile + IoT + cloud   | ₹1.5-3L      | Strong on mobile binary review       |
| Cure53 (Germany)    | Top-tier; crypto + web | ~€10-20k     | Stretch budget; gold standard        |
| Trail of Bits (US)  | Crypto + protocol      | ~$25-50k     | Out of bootstrap budget; aspirational|

Recommended path: **Payatu (mobile + web)** + **independent crypto review by
an academic** (₹50k–1L stipend) for the release engine + Shamir + Curve25519
boundary. Total: ~₹2-2.5L.

## Scope to hand the auditor

1. **Code repository read-only access** (we add an outside collaborator).
2. **Threat model**: `docs/security/threat-model.md`.
3. **Architecture**: `CLAUDE.md` + `docs/os-one-technical-spec.md`.
4. **Crypto layer**:
   - `apps/web/src/lib/stage1Crypto.js`
   - `apps/web/src/lib/shareCrypto.js`
   - `apps/web/src/lib/argon2.js`
   - `apps/web/src/lib/recoveryPhrase.js`
   - `apps/mobile/src/lib/crypto.ts`
   - `packages/crypto/`
5. **Release engine**:
   - `supabase/migrations/0005_release_engine.sql`
   - `supabase/migrations/0006_release_engine_rls.sql`
   - `supabase/migrations/0007_invite_helpers.sql`
   - `supabase/migrations/0008_release_claim_flow.sql`
   - `supabase/migrations/0010_nominee_combine.sql`
   - `supabase/functions/send-key-holder-invite/`
   - `supabase/functions/release-alert-dispatcher/`
6. **Billing**:
   - `supabase/migrations/0011_subscriptions.sql`
   - `supabase/migrations/0012_invoices_setup.sql`
   - `supabase/functions/razorpay-webhook/`
   - `supabase/functions/generate-invoice/`
7. **Test plan**: `docs/death-simulation-runbook.md`.
8. **A live staging environment** (separate Supabase project + Vercel preview)
   seeded with the demo data.
9. **Two test accounts** with known credentials (one paid Vault, one Family).
10. **Founder availability** for 30 min standups daily during the audit window.

## What we want them to look for

### Highest priority (must-find class)
- Vault decryption by anyone other than the owner.
- Forging a release without 3-of-5 + 14-day hold.
- Bypassing the 14-day hold (e.g. race condition on `ready_at`).
- RPC injection that lets a non-owner call `owner_abort_release` or
  `nominee_get_vault_blob`.
- Subscription state confusion (paid features for free users).
- Webhook replay against `razorpay-webhook` (HMAC bypass or idempotency gap).
- Storage bucket misconfiguration on `death_certificates` or `invoices`.
- Mobile: vault key leakage into Keychain/Keystore without encryption.
- Mobile: deep link injection (e.g. attacker controls `claim/[token]` URL).

### High priority
- RLS bypass on `vault_blobs`, `key_shares`, `audit_log`.
- Signed URL TTL on death certificate + invoice downloads.
- CSRF on Edge Function endpoints.
- Push token leakage.
- Magic link single-use enforcement.

### Medium priority
- DoS via expensive Argon2id calls (rate limit unlock).
- Account enumeration via signup / magic link timing.
- XSS in announcement / capture / nominee name fields.
- Mobile binary unpack: presence of API keys.

## Deliverables we expect from the auditor

1. PDF report with findings ranked CVSS-style.
2. Working PoC for each Critical / High.
3. Suggested fix per finding.
4. Re-test pass after we ship fixes (one round included).
5. Public attestation we can put on `/security` after re-test passes.

## Timeline

| Week | Activity                                                    |
|------|-------------------------------------------------------------|
| -2   | Pick firm, sign engagement letter, NDA, set up staging      |
| -1   | Hand over scope + credentials; kick-off call                |
| 1-2  | Active audit window                                          |
| 3    | Findings delivered                                           |
| 4    | We ship fixes for Critical + High                            |
| 5    | Re-test pass                                                 |
| 6    | Public attestation                                           |

Total: ~6 weeks. Block this window before announcing public launch.

## Founder responsibilities during audit

- 30 min daily standup with the audit team.
- Same-day answer SLA on architecture questions.
- Do NOT push any new feature to `main` during the active audit window.
- Block all crypto / release / billing changes until re-test passes.
