# Cyber Liability Insurance — Procurement Brief

_Owner: founder. Target purchase date: before public launch._

## Why we need it

1. A breach of encrypted data — even if we shipped no fault — still triggers
   investigation costs, legal counsel, breach notifications, and credit
   monitoring. Out-of-pocket easily ₹10-25L.
2. India's DPDPA penalties go up to ₹250 crore for serious failures. Even a
   nominal fine + legal defence is bankruptcy for a bootstrap.
3. Vendor due-diligence from B2B family-plan customers will ask for it.

## What we want covered

| Coverage                          | Minimum sum insured | Notes                                  |
|-----------------------------------|---------------------|----------------------------------------|
| Data breach response              | ₹2 crore            | Forensics, legal, notification, PR     |
| Third-party liability             | ₹3 crore            | User claims, regulator action          |
| Business interruption             | ₹50 lakh            | Loss of revenue during outage          |
| Cyber extortion / ransomware      | ₹1 crore            | Crypto-friendly clause                 |
| Privacy regulatory defence        | ₹1 crore            | DPDPA + GDPR + state laws              |
| Media liability                   | ₹25 lakh            | Defamation, IP infringement            |
| Crime / wire-transfer fraud       | ₹50 lakh            | Founder mailbox compromise scenario    |

**Target aggregate limit: ₹5-7 crore. Annual premium: ₹40k–₹1.2L.**

## Indian providers to quote (request 3 quotes)

| Insurer                             | Strengths                          | Approx. premium |
|-------------------------------------|------------------------------------|------------------|
| ICICI Lombard — CyberSecure         | India-focused; good DPDPA wording  | ₹50-80k          |
| HDFC ERGO — Cyber Sachet            | SMB friendly; quick KYC            | ₹40-70k          |
| Tata AIG — CyberEdge                | Excellent legal panel              | ₹60-1.2L         |
| Bajaj Allianz — Cyber Safe          | Cheaper but tight sub-limits       | ₹35-60k          |

Brokers (handle multiple quotes for free): **Policybazaar for Business**,
**Marsh India**, **PolicyX**.

## Application packet (have ready)

1. Company registration (Signor Vale AI).
2. PAN + GST.
3. Audited financials (if available; first-year affidavit otherwise).
4. Description of operations (we can copy-paste from the privacy page).
5. Number of records held + classification (count from `vault_blobs`; class:
   "Encrypted personal records; provider cannot decrypt").
6. Security controls questionnaire — answer using `docs/security/threat-model.md`
   + `docs/security/audit-prep-checklist.md`.
7. Subcontractor list (`apps/web/public/legal/sub-processors.html`).
8. Last security audit report (after Phase 6 audit ships).
9. BCP/DR plan (`docs/runbooks/`).
10. Founder background (LinkedIn).

## Timeline

| Week | Activity                                       |
|------|-----------------------------------------------|
| -4   | Request 3 quotes via broker                    |
| -3   | Compare, negotiate sub-limits                  |
| -2   | Sign + pay first premium                       |
| -1   | Put policy number on `/security` page          |
| 0    | Public launch                                  |

## Renewal

Annual. Review sum insured every 6 months as user count grows. Re-quote at
12 months — Indian cyber premiums are dropping faster than US.
