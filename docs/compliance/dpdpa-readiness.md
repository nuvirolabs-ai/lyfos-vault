# DPDPA 2023 — Readiness Pack (India)

_The Digital Personal Data Protection Act, 2023 + draft Rules (2025). Last
reviewed: 2026-05-28._

Lyfos Vault is a **Data Fiduciary** under DPDPA §2(i). India users are the
**Data Principals**. We process personal data of children only by
parent/guardian (§9) — we do not currently support under-18 sign-up.

## Section-by-section mapping

| DPDPA section                          | Our compliance                                                                                                   | Artefact                                              |
|----------------------------------------|------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| §4 – Lawful basis (consent / legit)    | Consent at signup; granular for marketing emails                                                                  | Signup screen + `/legal/privacy.html`                 |
| §5 – Notice                            | Plain-language notice at signup; English + Hindi by Phase 7                                                       | `/legal/privacy.html`                                 |
| §6 – Consent (free, specific, informed)| Affirmative ticks; no pre-checked boxes; granular for analytics + marketing                                       | Signup screen                                         |
| §7(a) – Withdraw consent               | Settings → Privacy → Withdraw consent. Withdrawal scope = future processing only                                  | Settings screen                                       |
| §8 – Data Fiduciary obligations        | Implemented end-to-end                                                                                            | This document                                         |
| §8(3) – Reasonable security safeguards | E2EE, Argon2id KDF, RLS, TLS 1.3, audit log, threat model                                                         | `docs/security/threat-model.md`                       |
| §8(4) – Breach notification            | 72-hour notice to DPB + affected Principals via in-app + email                                                    | `docs/runbooks/data-breach.md`                        |
| §8(7) – Erasure on consent withdrawal  | Delete account RPC (`delete_account`) wipes vault blob + audit log + billing PII (we keep invoice metadata for tax) | Migration `0003_account_deletion.sql`                 |
| §9 – Children's data                   | Min age 18; we ask DOB at signup (Phase 7)                                                                        | Signup screen                                         |
| §10 – Significant Data Fiduciary       | Not currently classified; we will register if notified                                                            | This document                                         |
| §11 – Right to access                  | Settings → Export my data (Phase 6, see below)                                                                    | Settings screen                                       |
| §12 – Right to correction              | Built-in: users edit their own vault                                                                              | App functionality                                     |
| §13 – Right to grievance redressal     | grievance@lyfos.signorvale.com + officer name in privacy page                                                     | `/legal/privacy.html`                                 |
| §14 – Right to nominate                | This is literally the product                                                                                     | Release plan flow                                     |
| §15 – Duties of Data Principal         | Linked in privacy page                                                                                            | `/legal/privacy.html`                                 |
| §16 – Cross-border transfers           | Default: data stays in Mumbai (Supabase ap-south-1)                                                               | This document + SETUP.md region choice                |
| §17 – Exemptions                       | N/A                                                                                                              | —                                                     |
| §18-25 – DPB powers                    | We will cooperate with notices; appoint grievance officer + DPO                                                   | This document                                         |

## Grievance Officer (mandatory under §13)

| Field        | Value                              |
|--------------|------------------------------------|
| Name         | _Founder — fill in legal name_     |
| Designation  | Founder, Lyfos Vault               |
| Email        | grievance@lyfos.signorvale.com     |
| Phone        | _Fill in_                          |
| Address      | _Registered office address_       |
| Response SLA | 30 days (DPDPA Rule 6 default)     |

To-do: add this block to `/legal/privacy.html` before public launch.

## Data Protection Officer (DPO)

DPDPA only requires a DPO for Significant Data Fiduciaries. We will appoint
one when we cross 10,000 paid users OR when notified by the DPB. Until then,
the founder is the de-facto DPO with the same contact.

## Record of Processing Activities (ROPA)

| Activity                | Purpose                              | Categories of data                                       | Legal basis    | Retention                | Recipients                  |
|-------------------------|--------------------------------------|----------------------------------------------------------|----------------|--------------------------|-----------------------------|
| Account creation        | Provide the service                  | Email (verified), hashed password (Supabase Auth)        | Consent §6     | Until account deletion   | Supabase (processor)        |
| Vault sync              | Cross-device sync of E2EE blob       | Ciphertext only (we never decrypt)                       | Consent §6     | Until account deletion   | Supabase                    |
| Release engine          | Honour right to nominate §14         | Holder emails, nominee email, death cert PDF             | Consent §6     | 7 years post-release     | Supabase, Resend            |
| Alerts                  | Owner-protection alerts              | Email + phone (if provided)                              | Legitimate use | While alerts pending     | Resend, MSG91, Meta, Expo   |
| Billing                 | Subscription fees                    | Name, address, GSTIN, state, payment metadata            | Contract       | 7 years (Indian tax law) | Razorpay, Lyfos accounting  |
| Audit log               | Security incidents + DPDPA §8(8)     | User id, event type, timestamp, IP                       | Legitimate use | 2 years                  | Supabase                    |
| Push tokens             | Mobile alerts                        | Expo push token                                          | Consent §6     | Until app uninstall      | Expo / Apple / Google       |
| Support tickets         | Resolve user issues                  | Email, message body                                      | Contract       | 2 years                  | Lyfos founder mailbox       |

## Right to access — implementation note

Implement `Settings → Export my data` (Phase 6 close-out):
- Encrypted vault blob (raw JSON envelope).
- Audit log entries for this user (JSON).
- Subscription + invoice metadata (JSON).
- All push tokens (JSON).
- Profile data (email, created_at, last sign-in).

Deliver as a single ZIP via signed URL within 30 days of request.

## Cross-border transfer note

Default region is **ap-south-1 (Mumbai)**. For non-India users, vaults are
still stored in Mumbai unless we open a regional fork. Edge function execution
runs in the user's nearest Supabase region; only metadata transits.

Resend (US), MSG91 (India), Meta WhatsApp (Ireland for EU traffic, Singapore
for ROW), Expo (US), Razorpay (India) are sub-processors. All are listed in
the privacy page and bound by data-processing addendums.

## Open items before public launch

- [ ] Replace founder placeholder in Grievance Officer block.
- [ ] Hindi translation of privacy page.
- [ ] DOB collection at signup (block under-18).
- [ ] In-product "Export my data" button.
- [ ] Sub-processor list page (`/legal/sub-processors.html`).
- [ ] DPA template for B2B family plans (`docs/compliance/dpa-template.md`).
