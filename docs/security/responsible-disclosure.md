# Lyfos Vault — Responsible Disclosure Policy

_Last updated: 2026-05-28_

## Our commitment

Lyfos Vault holds the most sensitive records of our users' lives — passwords,
identity documents, banking, insurance, and the keys their families will need
after they die. Security is not a feature for us; it is the product. We
welcome reports from security researchers and treat every disclosure as a
serious matter.

## Scope

**In scope**
- `https://lyfos.signorvale.com` and all subdomains
- Lyfos iOS app (Apple App Store bundle id `com.lyfos.vault`)
- Lyfos Android app (Play Store package `com.lyfos.vault`)
- Supabase edge functions in our project
- The cryptographic protocol (Argon2id → AES-GCM, Curve25519 NaCl box, Shamir SSS 3-of-5)
- The release engine (claim, hold, abort, combine flows)
- The billing pipeline (Razorpay webhook → invoice generation)

**Out of scope**
- Third-party services (Supabase, Razorpay, Resend, MSG91, Meta, Apple, Google)
  unless the bug is in our integration
- Denial of service that requires more than 100 req/s
- Reports from automated scanners without proof of impact
- Social engineering of Lyfos staff or users
- Physical security of our staff
- Self-XSS, missing security headers without a demonstrated exploit chain,
  clickjacking on pages without authenticated state changes

## How to report

Email **security@lyfos.signorvale.com** with:
1. A clear title.
2. Steps to reproduce.
3. Impact assessment.
4. Suggested fix if you have one.
5. Your preferred name + handle for the Hall of Fame (or "anonymous").

Encrypt sensitive reports with our PGP key at
`https://lyfos.signorvale.com/.well-known/pgp-key.txt`.

## What we promise

| Severity      | First response | Triage decision | Fix target  |
|---------------|----------------|-----------------|-------------|
| Critical (P0) | 4 hours        | 24 hours        | 7 days      |
| High (P1)     | 1 business day | 3 business days | 30 days     |
| Medium (P2)   | 3 business days| 7 business days | 90 days     |
| Low (P3)      | 5 business days| 14 business days| Best effort |

We will:
- Acknowledge receipt within the window above.
- Tell you our triage decision (accept / dispute / duplicate / out of scope).
- Keep you updated at least every 14 days while the fix is in progress.
- Credit you in the Hall of Fame after the fix ships (unless you opt out).
- Pay a bounty per the table in `docs/security/bug-bounty.md`.

## Safe harbour

If you make a good-faith effort to comply with this policy we will:
- Not pursue legal action under the Information Technology Act 2000 §43/§66,
  the DPDPA 2023, the CFAA, or equivalent laws elsewhere.
- Not pursue a DMCA takedown for reverse-engineering the apps for the purpose
  of finding bugs.
- Work with you to understand and resolve the issue quickly.

We expect researchers to:
- Avoid privacy violations, destruction of data, and interruption of service.
- Use only test accounts that you create yourself (do not access others' vaults).
- Give us reasonable time to investigate and fix before public disclosure.
- Not extort us. Bounty amounts are paid per the published table; demanding
  more in exchange for not disclosing is extortion, not research.

## Public disclosure timeline

Default: **90 days** from initial report, or 7 days after the fix ships,
whichever is sooner. We can negotiate longer windows for protocol-level
fixes that require coordinated rollout to mobile + web.

## Hall of Fame

Researchers who report valid issues are listed at
`https://lyfos.signorvale.com/security/hall-of-fame` with the date, severity,
and a one-line summary (no PII, no exploit details).
