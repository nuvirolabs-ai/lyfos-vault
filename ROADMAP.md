# Lyfos — Production Roadmap

> Working document. Updated as we ship. The plan is honest about how long real things take.

## North star

> **A nominee can actually recover a deceased user's life, end-to-end, without trusting Lyfos as a company.**

That is the only test that matters. Every feature either supports it or it doesn't ship. Net worth tracking, UI polish, mobile apps — all in service of that one promise.

## Product principles (non-negotiable)

1. **Zero-knowledge architecture.** Lyfos servers never see plaintext. Even if subpoenaed or breached, vault data is unreadable.
2. **Survivable to Lyfos shutting down.** A user's nominee must be able to recover the vault even if the company disappears. Forces open formats, exportable data, and (eventually) escrow.
3. **One honest sentence per feature.** No "this is a prototype" footnotes in production. Either the feature works as advertised, or it isn't there.
4. **Cohort first, scale second.** Ship to 30 friendly users → 100 → 1,000 → public. Don't market until the death-recovery test passes once in the real world.

## Anti-scope (will not build, even when tempted)

- Custodial wallets, brokerage, "we hold your money" features
- AI that categorizes documents server-side (breaks zero-knowledge)
- Family-sharing of live vault contents (only nominee-on-death access)
- Self-destruct / panic features (legal liability nightmare)
- Crypto private-key custody

---

## Founder decisions (locked)

| Decision | Choice | Implications |
|---|---|---|
| Team | Solo, full-time | ~6.5 month timeline. No contractor budget. Every week is on the founder. |
| Market | Globally-architected, India-launched | i18n + currency abstraction from Day 1; INR + India payments at launch; flip global switches at month 4 post-launch. |
| Nominee KYC | Skip — trust 3-of-5 keys | Acceptable IF key holders verify their own accounts (email + phone OTP), nominee ≠ key holder is enforced, and owner-abort during 14-day hold uses 4 channels (email + SMS + WhatsApp + push). |
| Budget | Bootstrap, ₹3–5L total | Allocation locked: ₹2L audit, ₹60k legal, ₹50k insurance, ₹40k infra, ₹20k misc, ₹30k contingency. Zero contractor budget. |

---

## Budget allocation (₹4L midpoint)

| Item | ₹ | Why this is non-negotiable |
|---|---|---|
| Security audit (Penetolabs / Astra) | 2,00,000 | A vault product without an audit will not earn trust. |
| Legal — ToS / Privacy / DPA (India + EU draft) | 60,000 | DPDPA + GDPR-strict from launch. |
| Cyber liability insurance (1 yr) | 50,000 | One breach without this and the founder is personally liable. |
| Infra runway (12 months) | 40,000 | Railway/Render + Postmark + Cloudflare + S3 (~₹3-4k/mo). |
| Domain, App Store, Play Store, misc | 20,000 | One-time fees. |
| Contingency | 30,000 | Something will break. |
| **Total** | **4,00,000** | |

---

# Phases

## Phase 0 — Honest beta (1 week)

**Goal:** make the current build safe for 30 friendly users for feedback only, without any feature pretending to be more than it is.

### Deliverables
1. Release tab renamed → **"Release plan (draft)"** with permanent banner: *"Lyfos cannot yet contact your nominees. This page stores your plan locally. You must print or share it manually until the release service launches in Q3."* Banner not dismissable.
2. Footer prototype text removed. Replaced with `Beta · v0.x · [last backup: N days ago]`.
3. Demo data moved behind `?demo=1` URL flag — not in default bundle.
4. Demo + Delete buttons moved out of persistent header into a Settings drawer.
5. Backup nudge: prominent banner on Home if last backup > 14 days.
6. Static **Terms of Service**, **Privacy Policy**, **Beta Disclaimer** pages — drafted with a lawyer.
7. Sentry + Plausible installed.
8. CSP / security headers configured at the host.
9. Service worker cache versioning by build hash.

### Acceptance
*"I would let my mother use the beta without worrying she'll lose data or be misled."*

### What stays broken
- Still localStorage only (single device)
- Still no real release flow
- Still no accounts

---

## Phase 1 — Accounts, identity, zero-knowledge sync (5 weeks)

**Goal:** vault survives device loss, syncs across phone + laptop, Lyfos still can't read it.

### Architecture
- **Backend:** Node + Postgres on Railway, AWS Mumbai migration once revenue justifies.
- **Auth:** Clerk or Supabase Auth (do not build auth from scratch).
- **Encryption model:**
  - Master passphrase → vault key via **Argon2id** (upgrade from PBKDF2).
  - Vault key encrypts the entire vault blob client-side.
  - Server stores: encrypted blob + version + timestamp + size. Never sees passphrase or key.
- **Recovery:** BIP39-style 24-word recovery phrase generated at signup. Only way to recover if passphrase forgotten. No email reset.

### Deliverables
1. User signup + email verification + login.
2. Vault blob upload/download API (encrypted only).
3. Optimistic local sync, last-write-wins conflict resolution.
4. Recovery key generation flow + drill ("paste your recovery key now to confirm you saved it").
5. Multi-device pairing flow.
6. Session management, device list, force-logout.
7. Encrypted backup auto-upload daily.
8. Account deletion flow (DPDPA / GDPR right to erasure).

### Anti-scope
- No social login.
- No org accounts / shared vaults.
- No password change without recovery key.

### Acceptance
*"I created a vault on MacBook, deleted Chrome, opened Lyfos on iPhone, entered my recovery key, saw my data."*

---

## Phase 2 — Balance sheet, made real (2 weeks)

**Goal:** the daily/monthly product that earns engagement.

### Deliverables
1. Monthly reminder email (1st of each month, if not yet updated).
2. Edit accounts after setup (add/remove/rename).
3. Bulk edit mode: all 12 numbers on one screen for power users.
4. Net worth chart: 12mo / 3yr / All time toggles.
5. Per-account history: tap an account, see its line over time.
6. Asset allocation pie/bar (equity / debt / real estate / cash split).
7. CSV export of all snapshots.
8. **Goals**: "Reach ₹1 Cr by Dec 2027" — single goal at a time, progress on Home.
9. Multi-currency abstraction in code (USD/EUR scaffolding hidden behind a flag).

### Anti-scope
- No bank linking / scraping in v1.
- No investment advice.
- No tax estimation.

---

## Phase 3 — Release engine, real (7 weeks, hardest phase)

**Goal:** when something happens to the user, their nominee actually gets their data.

### Architecture

**Key holders model:**
- Each key holder = real person with their own Lyfos account (verified email + phone OTP minimum).
- At setup, vault key is split with **Shamir's Secret Sharing** into 5 shares.
- Each share encrypted to a key holder's public key, stored server-side.
- 3 shares can reconstruct the vault key.
- **Hard constraint: nominee cannot also be a key holder.** Enforced at setup.

**Release flow:**
1. Main Nominee initiates release request via signed link.
2. Nominee uploads death certificate (manual review by Lyfos for v1, no e-KYC).
3. Backend emails + WhatsApps all 5 key holders + the owner.
4. Each key holder logs in, decides to release their share or refuse.
5. Once 3+ key holders release → **14-day owner-protection hold** starts.
6. During hold: owner gets daily email + SMS + WhatsApp + push. Any one-tap aborts.
7. If hold completes without abort → 3 shares combine, vault key reconstructs, nominee downloads decrypted JSON of emergency-eligible records only.
8. Release logged immutably; owner account marked deceased; subscription canceled.

**Stack:**
- Shamir SSS: `secrets.js-grempe`.
- Email: Postmark or Resend.
- WhatsApp: Meta Cloud API direct.
- SMS: MSG91.
- Cron + queue: `pg-boss` (Postgres-backed, no Redis dependency).

### Deliverables
1. Key holder accounts + invite flow (must verify email + phone).
2. Shamir share generation + server-side storage of encrypted shares.
3. Death certificate upload + manual review flow.
4. Key holder approval UI (mobile-friendly — most respond on phone).
5. **Owner-protection 14-day hold** with 4-channel alerts (email + SMS + WhatsApp + push).
6. One-tap abort from any channel.
7. Release execution + immutable audit log.
8. Nominee download experience (signed S3 link to zipped JSON + PDFs).
9. **End-to-end death simulation test** with founder + 5 friends acting as the cast. This is the acceptance test.

### Anti-scope
- No inheritance / will integration.
- No variable holds (always 14 days in v1).
- No variable thresholds (always 3-of-5 in v1).
- No partial release (all-or-nothing).
- No automated nominee KYC in v1.

---

## Phase 4 — Payments + plans (2 weeks)

**Goal:** revenue.

### Plan structure
- **Free:** balance sheet + up to 10 vault items, no release service.
- **Lyfos Vault (₹999/yr):** unlimited vault, full release service, 5 key holders, annual death drill reminder.
- **Lyfos Family (₹2,499/yr):** up to 4 vaults under one account.

### Deliverables
1. Razorpay subscriptions (INR primary).
2. Stripe stub coded but not enabled (for global launch later).
3. GST-compliant invoices (auto-generated).
4. Billing portal: see plan, cancel, change card.
5. Grace period for failed payments (7 days before read-only).
6. Refund policy: 14-day no-questions.

---

## Phase 5 — Mobile apps (7 weeks)

**Goal:** the actual daily-use surface.

### Stack
- **React Native + Expo** for max code reuse with web.
- Native modules only for: biometric unlock, secure storage, push.

### Deliverables
1. iOS + Android via Expo EAS.
2. FaceID / TouchID / fingerprint unlock.
3. Push notifications (most critical channel for release-hold abort).
4. Camera capture for vault attachments.
5. App Store + Play Store listings (allow 2 weeks for review).

### Anti-scope
- No watchOS / Wear OS in v1.
- No widgets in v1.
- No tablet layouts in v1.

---

## Phase 6 — Compliance, security, trust (3 weeks, parallel with Phase 5)

**Goal:** be the most boring, audit-able vault on the market. Trust is a feature.

### Deliverables
1. **Independent security audit** (Penetolabs ~₹2L). Publish the report.
2. **DPDPA + GDPR-strict compliance pack:**
   - Privacy Policy GDPR-aligned (DPDPA-compatible)
   - Consent management (one-tap "delete my account + all data")
   - Indian data residency confirmed (AWS Mumbai)
3. **Security.txt + responsible disclosure** at `/.well-known/security.txt`.
4. **Bug bounty:** ₹5k–25k for critical, via Bugcrowd or similar.
5. **Operational runbooks:** Postmark outage during release? Razorpay deactivation? Written procedures.
6. **Cyber liability + professional indemnity insurance** (~₹50k/yr).
7. **Customer support SLA:** `support@` inbox, 24h response commitment.
8. **Status page** at status.lyfos.com (Uptime Kuma or BetterStack).

### Anti-scope (for now)
- SOC 2 (revisit at ₹2 Cr ARR).
- ISO 27001 (same).

---

## Phase 7 — Launch (2 weeks)

**Goal:** open public signups, controlled.

### Deliverables
1. Marketing site at lyfos.com (separate from app): home, security, pricing.
2. Onboarding email sequence (7 emails over 30 days).
3. Press kit (security paper, founder story, screenshots).
4. Founding members invite list (1,000 from beta + waitlist).
5. **Launch on a Tuesday morning IST.** Never Friday.
6. **One real death-recovery test demonstrated publicly** as launch proof — blog post about it.

### Anti-scope
- No Product Hunt launch (delay to month 3 post-launch).
- No paid ads until cohort retention > 60% month-2.

---

## Honest timeline

| Phase | Weeks |
|---|---|
| 0. Honest beta | 1 |
| 1. Accounts + zero-knowledge sync | 5 |
| 2. Balance sheet polish | 2 |
| 3. Release engine | 7 |
| 4. Payments | 2 |
| 5. Mobile | 7 |
| 6. Compliance (parallel with 5) | 3 |
| 7. Launch | 2 |
| **Total** | **~26 weeks (~6 months)** |

**Public launch target: late November 2026.**

---

## First 30 days, concrete

### Week 1 — Phase 0
- Day 1–2: Release banner + prototype copy cleanup. Demo/Delete into Settings drawer.
- Day 3–4: Demo data behind `?demo=1` flag.
- Day 5: Service worker cache versioning. Sentry + Plausible.
- Day 6–7: Backup nudge on Home. Draft ToS/Privacy/Beta Disclaimer → lawyer.

### Week 2 — Phase 1 begins
- Day 1–3: Postgres on Railway. Auth scaffolding (Clerk or Supabase Auth).
- Day 4–7: Argon2id migration. BIP39 recovery key flow. Recovery drill.

### Week 3 — Encrypted vault sync
- Day 1–4: Vault blob upload/download API. Optimistic sync.
- Day 5–7: Conflict resolution. Daily auto-backup.

### Week 4 — Multi-device + recovery
- Day 1–3: Multi-device pairing. Device list.
- Day 4–5: Recovery key restore. **Cross-device test must pass.**
- Day 6–7: Email magic links. Account deletion (DPDPA/GDPR).

---

## Risks the founder chose to take

These were flagged and accepted. Worth re-reading before launch:

1. **Skipping nominee KYC** for v1. Mitigated by key-holder account verification + nominee ≠ key holder + 4-channel owner alerts. Risk: a coordinated social engineering of 3 key holders could trigger premature release. Acceptable given owner has 14 days to abort.
2. **Global from Day 1.** Mitigated by India-launch with global-ready architecture. Risk: if global compliance burden grows faster than expected, may need to revert to India-only.
3. **Bootstrap budget.** Risk: any one major item (audit, legal, insurance) running over budget eats contingency fast. Discipline on scope is the only protection.
4. **Solo founder, 6 months.** Risk: founder burnout. Mitigation: weekly review against this roadmap; ruthless about anti-scope; one full day off per week.
