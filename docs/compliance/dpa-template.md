# Data Processing Addendum — Template

_For B2B Family / Workspace plans where Lyfos is a Processor under GDPR Art. 28
/ DPDPA. Counter-sign on company letterhead._

This DPA forms part of the Lyfos Vault Subscription Agreement between
**Lyfos (Signor Vale AI)** ("Processor") and the **Customer** ("Controller").

## 1. Subject matter

Processing of Personal Data by the Processor on behalf of the Controller as
necessary to provide the Lyfos Vault service.

## 2. Duration

For the term of the Subscription Agreement + 30 days for return/deletion.

## 3. Nature & purpose

Storage of end-to-end-encrypted vaults, transmission of release alerts,
billing. The Processor does not access plaintext.

## 4. Types of Personal Data

Email addresses, phone numbers (optional), display names, billing
information (GSTIN, billing address). Encrypted vault content is opaque to
the Processor.

## 5. Categories of Data Subjects

Controller's employees, family members, or authorised users.

## 6. Obligations of the Processor

1. Process Personal Data only on documented instructions of the Controller.
2. Ensure persons authorised to process data are bound by confidentiality.
3. Implement Art. 32 technical + organisational measures (see Annex II).
4. Assist the Controller in responding to Data Subject requests.
5. Notify the Controller of a Personal Data breach without undue delay
   (target: 48 hours).
6. Assist with DPIAs and prior consultation if requested.
7. Delete or return Personal Data at end of services.
8. Make available all information necessary to demonstrate compliance.

## 7. Sub-processors

The Controller authorises the use of the sub-processors listed at
`https://lyfos.signorvale.com/legal/sub-processors.html`. The Processor will
give 30 days notice before adding new sub-processors and the Controller may
object on reasonable grounds.

## 8. International transfers

Default region: Mumbai (Supabase ap-south-1). SCCs (EU 2021/914) apply where
data flows to sub-processors outside the EEA / India.

## 9. Audits

The Controller may, no more than once per year, request a SOC 2 / ISO 27001
report (when available) or an audit by an independent third party, subject to
reasonable confidentiality and scheduling constraints.

## 10. Liability

Per the Subscription Agreement.

---

### Annex I — Description of Processing

| Field                    | Value                                                  |
|--------------------------|--------------------------------------------------------|
| Categories of Data Subjects | Controller's authorised users                       |
| Categories of Personal Data | Email, phone, encrypted vault blobs, billing PII    |
| Sensitive data           | Encrypted vault may contain sensitive data, but Processor cannot decrypt |
| Nature of processing     | Storage, transmission, alerts, billing                 |
| Purpose                  | Provide the Lyfos Vault service                        |
| Duration                 | Term of Subscription Agreement + 30 days               |

### Annex II — Technical & Organisational Measures

1. End-to-end encryption (AES-256-GCM, Argon2id KDF).
2. TLS 1.3 in transit.
3. Row-Level Security on all tables; SECURITY DEFINER RPCs for state transitions.
4. Audit logging of access and state changes.
5. Background checks on personnel with admin access.
6. Annual security audit by independent firm.
7. Bug bounty programme.
8. 99.5% monthly availability SLO.
9. Backups encrypted at rest.

### Annex III — Sub-processors

See `https://lyfos.signorvale.com/legal/sub-processors.html`. As of
2026-05-28: Supabase (DB + Auth + Storage + Edge Functions), Razorpay
(payments), Resend (email), MSG91 (SMS), Meta (WhatsApp Cloud API), Expo
(push notifications), Apple (iOS push), Google (Android push), Vercel
(static hosting).

---

Signed for and on behalf of the Controller:

Name:
Title:
Date:

Signed for and on behalf of Lyfos (Signor Vale AI):

Name:
Title: Founder
Date:
