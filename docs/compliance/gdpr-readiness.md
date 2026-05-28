# GDPR — Readiness Pack (EU/EEA + UK)

_Reviewed: 2026-05-28. We are a Controller for end-users, and a Processor
for B2B family-plan organisations._

We do not currently target the EU as a primary market, but we accept EU users.
This document is the minimum we need to be defensible.

## Article-by-article mapping

| GDPR article                               | Our position                                                                                       |
|--------------------------------------------|----------------------------------------------------------------------------------------------------|
| Art. 5 — Principles                        | Lawfulness, fairness, transparency, minimisation, accuracy, storage limitation, integrity (E2EE)   |
| Art. 6 — Lawful basis                      | Consent (signup, marketing) + Contract (billing) + Legitimate interests (security, alerts)         |
| Art. 7 — Conditions for consent            | Affirmative, unbundled, withdrawable; logged with timestamp                                        |
| Art. 9 — Special category data             | We do not knowingly process health, religion, etc. Users may put it in their vault, but it never leaves their device unencrypted |
| Art. 12-22 — Data subject rights           | Access, rectification, erasure, restriction, portability, objection — all via Settings + email     |
| Art. 25 — Data protection by design        | E2EE; minimal metadata; defaults to private                                                        |
| Art. 28 — Processor contracts              | Signed DPAs with Supabase, Razorpay, Resend, MSG91, Meta, Expo                                     |
| Art. 30 — ROPA                             | See `docs/compliance/dpdpa-readiness.md` — same list applies                                       |
| Art. 32 — Security of processing           | E2EE, RLS, TLS 1.3, audit log; aligns with the threat model                                        |
| Art. 33-34 — Breach notification           | 72 hours to lead SA; notify affected users without undue delay                                     |
| Art. 35 — DPIA                             | `docs/compliance/dpia-release-engine.md` for the release engine (high-risk processing)             |
| Art. 37 — DPO                              | Not mandatory for us (no large-scale special category data); we will appoint when scale demands     |
| Art. 44-50 — International transfers       | SCCs with sub-processors; Mumbai region by default; UK adequacy via UK GDPR                        |

## Lead Supervisory Authority

We do not yet have an EU establishment, so under Art. 27 we should appoint an
EU representative once EU users exceed 10% of total or 250 individuals
(whichever is lower). Until then, complaints go to the user's local DPA.

Recommended EU representative service: **Prighter** or **InstantGDPR** —
~€50-100/month. Defer until EU traction is real.

## Cookies / ePrivacy

We use zero non-essential cookies on the marketing site and the app. The only
cookies are:
- Supabase session token (essential — auth).
- Locale preference (essential — UI).

No cookie banner needed because no tracking. If we add analytics, switch to a
privacy-first stack (Plausible / Umami) and update privacy page.

## Open items before EU launch

- [ ] EU representative appointed (if EU traction > 10%).
- [ ] Privacy page available in German, French, Spanish (machine + review).
- [ ] DPIA reviewed by external counsel (~€2k stretch).
- [ ] Sub-processor list with locations + DPAs uploaded.
- [ ] Verify Supabase ap-south-1 + Resend (US) data flows are covered by SCCs.
