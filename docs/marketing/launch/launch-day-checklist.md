# Launch Day Checklist

**Tuesday morning IST. Never Friday.** Specifically: a Tuesday in the
first half of the month, away from any major Indian festival or US
holiday. Press desks are clearest Tuesday/Wednesday/Thursday morning.

## T -14 days

- [ ] External security audit re-test passes; attestation drafted
- [ ] Cyber liability insurance policy signed; number on `/security`
- [ ] PGP key generated + published at `/.well-known/pgp-key.txt`
- [ ] All inbound email aliases configured + tested
- [ ] Mobile apps approved on App Store + Play Store (TestFlight + Internal Testing live)
- [ ] Status page set to "Pre-launch"
- [ ] Founding-members invite list finalised in Notion/Airtable
- [ ] Press kit ZIPs uploaded to `apps/marketing/press/assets/`
- [ ] OG image (`/og.png`) created
- [ ] Blog post "We released a vault" final-final draft, founder-reviewed

## T -7 days

- [ ] Founding members Email 1 sent to beta + personal-network cohort (~250 people)
- [ ] Press kit emailed to 8 journalist contacts under embargo through launch day
- [ ] Twitter/X account `@lyfos` populated with 10 posts (architecture, threat model, screenshots)
- [ ] Final death-simulation runbook executed on prod against the founder's vault
- [ ] Backup operator briefed in person; sealed envelope placed
- [ ] Supabase on Pro tier (PITR + 30-day backups)
- [ ] Domain `lyfos.com` pointed at marketing Vercel project
- [ ] `lyfos.com` → marketing; `lyfos.signorvale.com` → app (no change needed)
- [ ] Universal Links (`apple-app-site-association`, `assetlinks.json`) verified end-to-end

## T -1 day (Monday)

- [ ] Get a full night's sleep. Do not push code today.
- [ ] Send the launch tweet draft to one trusted reader for one final eye
- [ ] Pre-write three "things that could go wrong" status-page incident templates
- [ ] Confirm Razorpay live keys + GST registration in production
- [ ] Confirm at least 5 founding members have completed end-to-end (signup → upgrade → release plan finalised) on prod

## Launch day (Tuesday)

| Time IST | Action                                                                       |
|----------|------------------------------------------------------------------------------|
| 07:00    | Coffee. Check status.supabase.com + status.razorpay.com — must be green     |
| 07:30    | Final smoke test: signup, upgrade, release-plan finalise on a fresh email   |
| 08:00    | Founding-members Email 1 sent to the waitlist (~600 people)                  |
| 08:30    | Twitter/X launch thread (5 tweets, screenshots, security link)               |
| 09:00    | Blog post "We released a vault" goes live at /blog/we-released-a-vault.html  |
| 09:00    | LinkedIn post (founder personal)                                             |
| 09:15    | Email to the 8 embargoed journalists with "you're now free to publish"      |
| 10:00    | First inbox check. Respond to every reply.                                  |
| 11:00    | Watch funnel: waitlist email → site → signup → upgrade                       |
| 12:00    | Lunch. Status check.                                                         |
| 13:30    | Second inbox check                                                          |
| 15:00    | Twitter quote-tweets / DM responses                                          |
| 18:00    | Inbox close-out. Anything not handled goes to tomorrow with a 15-word reply  |
| 22:00    | Stop. Eat dinner. Don't push code.                                          |

## Launch + 1 day (Wednesday)

- [ ] Founding-members Email 2 sent to non-clickers from waitlist
- [ ] Public update post on Twitter with day-1 numbers (signups, conversions)
- [ ] Status-page update: "Launched. All systems operational."
- [ ] First retro: what surprised us in 24 hours

## Launch + 7 days

- [ ] Founding-members Email 3 sent to non-converters
- [ ] First weekly metrics email to self: signups, conversions, ARR, support volume
- [ ] First public "Notes from launch week" blog post

## Launch + 30 days

- [ ] Founding-members close: Email 4 sent; window closes; lifetime rate locked
- [ ] First quarterly "what should we build" email to founding members
- [ ] Confirm 1,000 founding-member target progress; extend window if needed
- [ ] Re-engage security auditor for post-launch checkpoint review

## What we do NOT do on launch day

- ❌ Push code
- ❌ Run a Product Hunt launch (deferred to month 3)
- ❌ Start paid ads (deferred until retention > 60% at month 2)
- ❌ Schedule any non-essential meetings
- ❌ Make any pricing changes
- ❌ Promise features in replies that aren't already on the roadmap
