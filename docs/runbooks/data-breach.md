# Runbook: Data breach

**Trigger:** Suspected or confirmed unauthorised access to user data.

## Hour 0 — Stop the bleed

1. Identify the scope: which table / function / bucket?
2. If active intrusion is ongoing:
   - Rotate the Supabase service role key (Dashboard → Settings → API → Reset).
   - Rotate the Razorpay webhook secret + all Edge Function secrets.
   - Disable the affected Edge Function (toggle off in dashboard).
   - If RPC-level: `revoke execute on function <name> from public, authenticated;`
3. Take a database snapshot for forensics (Dashboard → Database → Backups → Manual).
4. Preserve logs: export the last 7 days of Edge Function logs + Postgres
   `pg_stat_statements` + auth.audit_log_entries.

## Hour 0-2 — Triage

5. Determine: what data was exposed? Encrypted blobs (we don't care; it's
   ciphertext) vs metadata (emails, billing, audit log) vs both.
6. Count affected users (`select count(distinct user_id) from <table> where …`).
7. Identify the root cause: SQL injection, leaked key, RLS misconfig, vendor
   compromise, social engineering?

## Hour 2-24 — Communicate (DPDPA §8(4) gives us 72h to the DPB)

8. Email affected users — template at `docs/runbooks/templates/breach-email.md`.
9. Post on the status page.
10. File DPDPA breach report: portal at https://dpb.gov.in (when live; until
    then, email the address listed in the most recent DPB notification).
11. If EU users affected: notify lead SA within 72 hours (Art. 33).
12. If > 500 California users: California AG notice.

## Day 1-7 — Investigate

13. Engage external IR firm if needed (`docs/security/audit-prep-checklist.md`
    has the firm list).
14. Reproduce the issue, write the fix, peer-review it, ship.
15. Publish a public post-mortem on `lyfos.signorvale.com/security/incidents`.

## Day 7-30 — Close out

16. Add regression test for the root cause.
17. Update threat model with the new attack vector.
18. Insurance claim (`docs/compliance/cyber-insurance-procurement.md`).
19. Hall of Fame entry if external researcher.

## Do NOT

- Do not delete logs or audit entries.
- Do not pay extortion.
- Do not blame the user.
- Do not minimise to affected users — over-communicate.
