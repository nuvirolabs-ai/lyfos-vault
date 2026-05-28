# Lyfos Vault — Bug Bounty Programme

_Effective: 2026-05-28. Reviewed quarterly._

We run a private, self-funded bug bounty. Payouts are in INR (or equivalent in
your home currency at the day's rate, USD/EUR/GBP supported).

## Severity bands

| Severity | Example                                                                | Payout (INR) |
|----------|------------------------------------------------------------------------|--------------|
| Critical | Decrypt a vault you do not own; forge a release without 3-of-5 + hold; bypass the 14-day hold; recover a vault key from server-side data alone; RCE on Supabase functions; auth bypass to admin role | ₹1,00,000 – ₹3,00,000 |
| High     | Lock another user out of their vault; trigger release alerts on a vault you do not own; tamper with audit log; bypass free-tier limits server-side; XSS with session token theft; SSRF reaching Supabase service role | ₹25,000 – ₹75,000 |
| Medium   | CSRF on a state-changing endpoint without server-side mitigations; account enumeration with high precision; insecure-direct-object-reference on non-secret resources; mobile app local crypto leakage to non-encrypted storage | ₹5,000 – ₹20,000 |
| Low      | Open redirect; reflected XSS on logged-out pages; missing security headers with demonstrated exploitability; SPF/DKIM/DMARC weakness | ₹1,000 – ₹5,000 |

## What multiplies a payout

- **+50%** if the report includes a working fix that we accept.
- **+50%** if the report is a protocol-level break (crypto, release engine,
  Shamir reconstruction).
- **+100%** if the report demonstrates compromise of multiple users' vaults.

## What reduces a payout

- **-50%** if the bug requires a precondition we already document as risky
  (e.g. sharing your master passphrase, accepting an obviously-phishy invite).
- **-50%** for duplicates received within 72 hours of the original.
- **Zero** for issues out of scope per `responsible-disclosure.md`.

## Payment

- We pay within 30 days of fix deployment via UPI or bank transfer (India) or
  Wise (international).
- Bounties are taxable; we issue a TDS form 16A for Indian recipients above
  the ₹30,000 threshold per IT Act §194J.
- We cannot pay residents of sanctioned jurisdictions (OFAC list).

## Reserved cases

We reserve the right to:
- Pay above the band for exceptional findings.
- Pay below the band for low-impact variants of high-severity classes.
- Refuse payment for researchers who violate safe-harbour terms.

## Disputes

If you disagree with our triage decision, reply on the original thread with
"DISPUTE" in the subject. The founder will personally review within 5 business
days. There is no further internal escalation; if we still disagree after
that review we will say so plainly and you are free to publish.
