# Onboarding Email Sequence

7 emails over 30 days. Sent via Resend, triggered by lifecycle events in
Supabase (or scheduled via the existing `monthly-reminder` cron pattern).
Each one is short, signed by the founder, single CTA.

## Schedule

| # | Day | Trigger                                       | Subject                                                   |
|---|-----|-----------------------------------------------|-----------------------------------------------------------|
| 1 | 0   | Sign up confirmed                             | Welcome to Lyfos. Here's how it actually works.           |
| 2 | 1   | Hasn't added a record yet                     | The 10-minute setup that does the heavy lifting           |
| 3 | 3   | Hasn't set up the release plan                | The reason Lyfos exists is the release plan               |
| 4 | 7   | Recovery phrase not yet downloaded            | Don't skip this one. Your recovery phrase.                |
| 5 | 14  | Free tier hitting 8/10 records                | You're almost at the free-tier limit                      |
| 6 | 21  | All users                                     | One question, honestly                                    |
| 7 | 30  | All users                                     | A month with Lyfos. What changed for you?                 |

Triggers are evaluated at midnight IST. Each email is idempotent — we set
a flag in `audit_log` after sending so a re-run doesn't double-send.

## Voice

- Personal. Signed "— founder name, Lyfos."
- Plain text + minimal HTML. No marketing template.
- One CTA per email. Either a link into the app or a Reply-to-me.
- No emojis. No exclamation points except in the welcome.
- 200 words max each.

The files in this directory contain the body copy. Subject lines are in
the table above. Use `{{first_name}}` for the recipient's first name from
`auth.users.raw_user_meta_data`. Fall back to "there" if missing.
