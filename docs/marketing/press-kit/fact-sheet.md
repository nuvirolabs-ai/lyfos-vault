# Lyfos — Fact Sheet

**Lyfos** is a zero-knowledge, end-to-end-encrypted vault for the records
your family will need after you're gone — passwords, IDs, banking,
insurance, and the keys to all of it. Unlike a generic password manager,
Lyfos is designed from day one for life recovery, with a 3-of-5 social
release engine, a 14-day owner-protection hold, and multi-channel alerts.

| Field                  | Value                                                                       |
|------------------------|-----------------------------------------------------------------------------|
| Company                | Signor Vale AI Pvt Ltd                                                      |
| Product                | Lyfos Vault                                                                 |
| Headquarters           | India                                                                       |
| Founded                | 2026                                                                        |
| Founder                | Solo, full-time                                                             |
| Funding                | Bootstrap. No external capital.                                             |
| Platforms              | iOS, Android, Web (PWA)                                                     |
| Tech stack             | React + Vite (web), React Native + Expo SDK 52 (mobile), Supabase backend  |
| Architecture           | End-to-end encrypted, zero-knowledge, local-first with optional cloud sync  |
| Cryptography           | Argon2id (RFC 9106), AES-256-GCM, Curve25519 NaCl box, Shamir's 3-of-5 SSS  |
| Identity / KDF         | BIP39 24-word recovery phrase + master passphrase                           |
| Data residency         | Mumbai (Supabase ap-south-1) by default                                     |
| Compliance             | DPDPA 2023 (India); GDPR-ready (EU); cross-border transfers via SCCs        |
| Pricing                | Free (10 records) · Vault ₹999/yr · Family ₹2,499/yr (5 users)              |
| Public launch target   | Q4 2026 (India first; global rollout follows audit)                          |
| Website                | https://lyfos.com (app at https://lyfos.signorvale.com)                     |
| Press contact          | press@lyfos.signorvale.com                                                  |
| Repo (selective)       | https://github.com/signorvaleai-hash/lyfos-vault                            |

## What's distinctive

- **Zero-knowledge, not aspirational.** The protocol prevents Lyfos staff (including the founder) from reading any user vault. Verified by the public threat model.
- **3-of-5 release engine.** Five trusted humans, any three needed to release. Vault key split via Shamir's SSS; each share sealed to the holder's individual Curve25519 keypair.
- **14-day owner-protection hold.** From the moment three shares arrive, a 14-day countdown starts, with daily alerts on email + SMS + WhatsApp + push. One tap aborts.
- **No nominee KYC.** We trust the social 3-of-5 layer plus the hold, not document checks. (See blog post: "Why we don't ask your nominee for KYC.")
- **Local-first.** The product works offline. Cloud sync is optional. The company can disappear and your vault keeps working.
- **Honest pricing.** Founding members lock their price for life. Free tier never expires.

## Numbers (current)

- Codebase: ~15,000 lines across web + mobile + Supabase
- Test coverage: 108 web-side tests pass
- Migrations: 13 Postgres migrations
- Edge functions: 8
- Crypto library budget: ~150 KB gzip, lazy-loaded
- Time from sign-up to first record: target < 60 seconds
- Release engine end-to-end (sign-up to nominee download): ~44 days including the 14-day hold

## Not yet (deliberate)

- No Product Hunt launch
- No paid ads (until cohort retention proves the model)
- No biometric-only unlock without a passphrase (passphrase remains required)
- No "master key" recovery service (by design)
