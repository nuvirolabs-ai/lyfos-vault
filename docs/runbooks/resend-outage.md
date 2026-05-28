# Runbook: Resend (email) outage

**Trigger:** Edge Function logs show Resend API errors, monthly reminder /
release alert / invite emails not delivering.

## Diagnose

1. Check https://status.resend.com.
2. Look at Edge Function logs for `send-key-holder-invite`,
   `release-alert-dispatcher`, `monthly-reminder` — search "resend.com".
3. Check the Resend dashboard for failed deliveries / suppression list.

## Impact assessment

- **Magic links / signup confirmations**: critical. New users blocked.
- **Release alerts**: SMS + WhatsApp + Push are independent channels — owner
  still gets notified. Acceptable temporary degradation.
- **Monthly reminders**: low priority, can wait.

## Mitigation

4. If outage will last > 2 hours, switch to fallback provider:
   - Edit Edge Function env: change `RESEND_API_KEY` to a Postmark or
     SendGrid key + flip `EMAIL_PROVIDER` env to `postmark`/`sendgrid`.
   - Redeploy `send-key-holder-invite`, `release-alert-dispatcher`,
     `monthly-reminder`.
   - We don't currently have fallback accounts — provision Postmark
     ($15/month starter) as the secondary BEFORE we ever need it. Tracked
     in [open-issues.md](open-issues.md).
5. For magic links specifically: Supabase Auth has built-in SMTP — temporarily
   switch back to Supabase's default SMTP via Dashboard → Auth → Email.

## Recovery

6. Once Resend recovers, switch back. Verify a test signup + a test invite
   land in the inbox.
7. Re-run the most recent `release-alert-dispatcher` cron tick manually to
   resend missed alerts.
8. Check the Resend suppression list — bounces during outage shouldn't have
   added users.

## DKIM / SPF / DMARC failures

9. Check `lyfos.signorvale.com` DNS for SPF (`v=spf1 include:_spf.resend.com ~all`),
   DKIM (3 CNAME records per Resend dashboard), DMARC
   (`v=DMARC1; p=quarantine; rua=mailto:postmaster@lyfos.signorvale.com;`).
10. If DKIM is failing: Resend dashboard → Domains → re-verify.
