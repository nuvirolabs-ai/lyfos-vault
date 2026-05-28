# Runbook: Suspected bug in the release engine

**Trigger:** A user reports the release flow is misbehaving — wrongful
release in progress, abort not working, hold not counting down, nominee
can't download.

## Severity

Always **P0**. There is no scenario where a release-engine bug is not P0.

## Immediate triage (within 15 minutes)

1. Identify the `release_request_id` from the user's report or by querying
   `release_requests` for their email.
2. Pull the current state:
   ```sql
   select id, owner_id, nominee_email, state, ready_at, hold_until,
          aborted_at, completed_at, created_at, rejection_reason
     from release_requests
    where id = '<id>';
   ```
3. Pull the associated alerts:
   ```sql
   select channel, sent_at, error from release_alerts
    where release_request_id = '<id>' order by sent_at desc;
   ```
4. Pull the associated share releases:
   ```sql
   select holder_id, released_at from release_share_releases
    where release_request_id = '<id>' order by released_at desc;
   ```
5. Pull the audit log:
   ```sql
   select event, payload, created_at from audit_log
    where (payload->>'release_request_id') = '<id>'
       or (payload->>'request_id') = '<id>'
    order by created_at desc;
   ```

## If the owner is alive and a release is in progress

6. **Abort immediately on the owner's behalf** by calling the
   `owner_abort_release` RPC as the owner (use their auth token if the
   owner is on a call with you; otherwise instruct them to tap the abort
   link in any alert email).
7. If the owner is locked out: as super-admin, mark the release `cancelled`
   manually:
   ```sql
   update release_requests
      set state = 'cancelled', aborted_at = now()
    where id = '<id>' and state in ('approved','awaiting_shares','holding','ready_to_release');
   ```
   Append to audit log: `manual_abort_super_admin`.
8. Email the owner + nominee with the action taken.

## If the 14-day hold is not enforcing

9. Check `hold_until` column: should be `ready_at + interval '14 days'`.
10. Check the `maybe_complete_hold` RPC + cron — must require `now() >= hold_until`.
11. If a misconfigured trigger let through a wrongful release: emergency
    rollback the nominee's download URL (revoke signed URL via Supabase
    Storage API).
12. Patch the trigger + redeploy + write a regression test + post-mortem.

## If a holder can't release

13. Check `key_shares.released` and `key_shares.holder_id` mapping.
14. Confirm the holder accepted the invite (`key_holders.verified = true`).
15. If the share is missing entirely: check the `assert_paid_for_release()`
    trigger — owner must be on a paid plan when shares were created.

## If a nominee can't download

16. Confirm `release_share_releases` has ≥ 3 rows for the request.
17. Confirm `release_requests.state = 'ready_to_release'`.
18. Confirm the nominee has the original claim token (URL).
19. Confirm `nominee_get_vault_blob` returns the encrypted vault.
20. If client-side combine fails: have them try on a different device. If
    still failing, the bug is in `shareCrypto.combineShares` — investigate
    against the test corpus in `apps/web/src/lib/shareCrypto.test.js`.

## After the incident

21. Write a fix; add a regression test that would have caught this.
22. Public post-mortem.
23. Hall of Fame entry if external researcher.
24. Update the threat model + this runbook.

## What never to do

- Never delete a `release_requests` row. Always state-transition.
- Never edit `audit_log`. Append-only.
- Never bypass the 14-day hold on behalf of a nominee. Even with a paper
  death certificate, the hold is the user-protection guarantee.
