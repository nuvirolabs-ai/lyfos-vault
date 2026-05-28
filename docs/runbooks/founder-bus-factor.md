# Runbook: Founder unavailable / bus-factor

**This is the most important runbook in this folder. It is the user-trust
backbone of the product. A company that runs the world's nominee service
must not itself collapse if the founder dies.**

## Persons designated

| Role                          | Person              | Contact                      | Has access to                                  |
|-------------------------------|---------------------|------------------------------|------------------------------------------------|
| Primary backup operator       | _Spouse / sibling_  | _phone, email_               | The sealed envelope below + this repository    |
| Secondary backup operator     | _Co-founder / CA_   | _phone, email_               | Sealed envelope, repository                    |
| Legal counsel                 | _Law firm_          | _phone, email_               | Reads + advises only                           |
| Auditor                       | _CA firm_           | _phone, email_               | Tax + invoice continuity                       |
| Domain registrar              | _Provider_          | account email                | DNS, email forwarding                          |

_Fill these in before public launch. The sealed envelope is the only place
these credentials live together — see below._

## The sealed envelope

A paper envelope, sealed, signed across the seal, kept in a fireproof safe
at the founder's primary residence. Contains:

1. Master GitHub PAT (read+write).
2. Supabase service-role key for `lyfos-prod`.
3. Razorpay account password + 2FA backup codes.
4. Domain registrar password + 2FA backup codes.
5. Vercel / hosting password + 2FA backup codes.
6. Apple Developer + Google Play passwords + 2FA backup codes.
7. EAS account password.
8. Lyfos founder Gmail + the Forwarding-As Recovery codes.
9. This document's persons-designated table.

Update annually. Re-seal on every update.

## Trigger conditions

- Founder unresponsive for > 7 calendar days.
- Founder confirmed deceased / incapacitated.
- Founder voluntarily hands over operations.

## Day 0-3 (primary backup operator)

1. Retrieve the sealed envelope.
2. Verify the founder's status via direct family contact.
3. Post a status-page notice: "Lyfos is operating under continuity. Service
   is unaffected. Founder out of contact; expected return: _date_."
4. Take over the founder Gmail; forward incoming mail to a personal address.
5. Do NOT change passwords yet (founder may return).

## Day 3-30 (extended absence)

6. Coordinate with legal counsel on succession.
7. Continue to operate the service. The product is autonomous for users in
   normal flows; only support escalations need human attention.
8. Daily check: status.supabase.com, status.razorpay.com, status.resend.com.
9. Weekly check: paid subscriptions are renewing; no spike in account
   compromise reports; release engine still functions.

## Day 30+ (likely permanent absence)

10. Legal succession of Signor Vale AI Pvt Ltd per shareholder agreement.
11. Public announcement.
12. Either:
    - Continue operating (preferred).
    - Find an acquirer (notify user base 90 days before any transfer; offer
      data export + account closure).
    - Sunset gracefully: 6-month notice; refund unused subscription terms;
      provide every user with their encrypted vault + recovery instructions.

## The minimal viable continuity team

If the founder dies on day 1 of public launch, the product can survive on
~4 hours/week of operator time, because:
- The release engine is autonomous (RPCs + cron + Edge Functions).
- Billing is autonomous (Razorpay + webhook + invoice gen).
- Vault sync is autonomous (Supabase).
- The only human-in-loop task is the admin review of release claims (we get
  one every few weeks at small scale). The backup operator can do this with
  the death-simulation runbook as their training.

This is by design. Lyfos is a product, not a service that needs a heroic
operator.

## Open issues

- [ ] Identify and brief the primary + secondary backup operators.
- [ ] Place the sealed envelope.
- [ ] Update shareholder agreement to allow founder-incapacity continuity.
- [ ] Pre-write the public continuity announcement (sentiment matters here).
