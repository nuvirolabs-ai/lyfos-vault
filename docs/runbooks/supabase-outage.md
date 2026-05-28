# Runbook: Supabase outage

**Trigger:** users can't sign in, sync fails, Edge Functions return 5xx,
status.supabase.com is red.

## Diagnose

1. Check https://status.supabase.com for our region (ap-south-1 Mumbai).
2. Check our project: https://app.supabase.com → ours → Reports.
3. Try the SQL editor — if it loads, it's an Edge Functions or Auth issue,
   not the whole platform.

## If Supabase is fully down

4. Update status page (`docs/runbooks/status-page-update.md`).
5. Tweet from @lyfos with a one-line acknowledgement linking to status page.
6. The app is local-first, so unlocked users can still read + write their
   vault. They can't sync, billing UI breaks, no alerts go out — but no data
   is lost. Communicate this.
7. Edge Function cron jobs (release-alert-dispatcher, monthly-reminder) will
   miss their windows. release-alert-dispatcher is idempotent per channel
   per day, so a delayed run just sends the same day's alert late — not
   double. Acceptable.

## If Auth specifically is down

8. New signups fail. Existing sessions keep working (JWT is verified locally).
9. Magic links and email verification queue up at Resend — they'll deliver
   when Auth recovers.
10. Display banner on the app: "Sign-in is temporarily unavailable. Your
    vault is still accessible if you're already signed in."

## If we hit free-tier limits

11. Upgrade to Pro ($25/mo). Pay personally; reimburse from biz account later.
12. Document in `docs/runbooks/limit-history.md` so we plan ahead.

## Recovery

13. Once status is green: run the cron jobs manually if they missed (call
    the Edge Function URLs).
14. Verify the most recent vault sync per active user (spot check 5).
15. Update status page to resolved.
16. Post a 1-paragraph post-mortem on the status page.

## Prevention

17. If our region keeps degrading, evaluate a multi-region read replica
    (Pro tier feature, ~₹4k/month).
