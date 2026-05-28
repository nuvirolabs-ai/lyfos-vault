# DPIA — Release Engine

_GDPR Art. 35 / DPDPA Rule 12. Owner: founder. Last reviewed: 2026-05-28._

## 1. Description of processing

The release engine allows a nominee to recover an encrypted vault after the
owner's death. It involves: 3-of-5 Shamir share split, key-holder
verification, nominee identity claim with death certificate upload,
admin review, 14-day owner-protection hold with multi-channel alerts,
and final emergency-bundle download.

## 2. Necessity & proportionality

| Question                              | Assessment                                                                                          |
|---------------------------------------|-----------------------------------------------------------------------------------------------------|
| Is the processing necessary?          | Yes — this is the core service the user signs up for                                                |
| Is there a less invasive alternative? | We considered nominee KYC; rejected because (a) hostile to grieving family, (b) we don't want PII   |
| Is the data minimised?                | Yes — we only collect what's needed (holder email, nominee email, death cert PDF, owner contact)    |
| Storage limited?                      | Yes — death cert deleted 90 days post-release; release rows kept 7 years for legal defensibility    |

## 3. Risks identified

| #  | Risk                                                  | Likelihood | Impact  | Mitigation                                                                                          |
|----|-------------------------------------------------------|------------|---------|------------------------------------------------------------------------------------------------------|
| R1 | Wrongful release (owner is alive)                     | Medium     | Severe  | 14-day hold + 4-channel alerts + one-tap abort + admin manual review                                |
| R2 | Holder collusion (3 of 5)                             | Low        | Severe  | Owner picks holders themselves; we recommend non-overlapping social circles                          |
| R3 | Fake death certificate                                | Medium     | Severe  | Admin review by trained human; sample comparison against state issuer formats                        |
| R4 | Nominee identity confusion                            | Low        | High    | Claim flow requires the exact email the owner set; admin double-checks                              |
| R5 | Owner contact details out of date (alerts misfire)    | Medium     | Severe  | Annual reminder to update contact; alerts go to 4 channels                                          |
| R6 | Death cert PDF leak from storage bucket               | Low        | High    | Bucket RLS; signed URLs ≤ 15 min; admin-only access                                                 |
| R7 | Audit log tampering                                   | Low        | High    | Append-only RLS; founder cannot delete entries                                                       |
| R8 | Service unavailable when family needs it              | Low        | Severe  | Status page + 99.5% SLO + manual fallback runbook                                                   |

## 4. Residual risk

Acceptable. The combination of social trust (3 of 5), time delay (14 days),
multi-channel alerts (4 channels), and human review (admin) means a successful
wrongful release requires either (a) the owner being unreachable on all 4
channels for 14 days, OR (b) the owner being actually dead — both of which
are within the design intent.

## 5. Consultation

To-do before launch:
- Pen-test the release flow as part of the security audit (`docs/security/audit-prep-checklist.md`).
- Cross-review with a death-doula or estate lawyer on UX of the claim flow.
- Two beta family-tester cycles before public launch.
