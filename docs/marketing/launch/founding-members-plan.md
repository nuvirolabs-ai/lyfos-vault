# Founding Members — Launch Cohort Plan

Goal: bring 1,000 paying members through the door in the first 60 days
without paid acquisition, without Product Hunt, without growth tricks.

## Why a founding-members cohort

Lyfos is a slow-trust product. Users are letting us hold the keys their
family will need after they're gone. The right way to seed that trust
is with people who already have a relationship with us — directly or
once-removed — and let their behaviour over the first months prove that
the product earns the trust beyond the first wave.

Founding-members benefits (perpetual, not a launch gimmick):

1. **Lifetime founder rate.** Whatever they pay at signup, they pay
   forever. Future price increases never touch them.
2. **Founder-direct email line.** A real, monitored mailbox the founder
   replies to within one business day.
3. **First look at major features.** Beta access to anything new before
   it goes public.
4. **Voting voice.** Quarterly "what should we build" email with three
   options — founding members vote, results bind us.
5. **Founding-member badge in-app.** Visible only to them. Quiet
   acknowledgement, not a status symbol.

## Inventory

| Pool                          | Count | Source                                              | When invited |
|-------------------------------|-------|-----------------------------------------------------|--------------|
| Beta (pre-launch testers)     | ~50   | Direct invites during Phase 0-5 (track in Notion)   | Day -7       |
| Personal network (founder)    | ~200  | Founder's address book of relevant individuals      | Day -5       |
| Waitlist (lyfos.com signups)  | ~600  | Marketing site form, captured in Mailchimp/Resend   | Day 0        |
| Twitter/X early followers     | ~150  | @lyfos followers from pre-launch posts              | Day 0        |
| Referrals from above          | open  | Each founding member can invite up to 5             | Day 3+       |

Target conversion to paid: 60-70% of the directly-invited; 30-40% of
the waitlist; 5-10% of Twitter early followers. Working math:

```
50 × 0.80 = 40
200 × 0.50 = 100
600 × 0.30 = 180
150 × 0.07 = 11
direct conversions = 331

referral pool (capped 5 per founding member) → conservatively 500-700
total ≈ 1,000 founding members within 60 days
```

If the numbers undershoot, we extend the founding-member window. We do
not cap based on date — we cap based on the 1,000 number and let the
window flex. Honesty over urgency.

## Cohort emails (4 emails across 7 days from invite)

| # | Day  | Audience      | Subject                                       |
|---|------|---------------|-----------------------------------------------|
| 1 | 0    | invitee       | A first look at Lyfos. Founding members only. |
| 2 | 2    | non-clickers  | Quick reply with one question                  |
| 3 | 5    | non-converters| What's making you hesitate?                    |
| 4 | 7    | non-converters| Closing your founding-member window           |

Body copies in `docs/marketing/launch/founding-members-emails.md`.

## Anti-patterns we're not doing

- ❌ Fake scarcity ("Only 17 spots left!")
- ❌ Time-pressure framings that don't match reality
- ❌ Affiliate / referral rewards that reward virality over fit
- ❌ Bait-and-switch ("free for 30 days then we charge")
- ❌ Mass-emailing a list we bought

## Tracking

- All founding members tagged in Supabase: `auth.users.raw_user_meta_data.founding_member = true`.
- Source attributed in `raw_user_meta_data.acquisition_source` ('beta' | 'personal' | 'waitlist' | 'twitter' | 'referral').
- Lifetime rate enforced by a `billing_profile.locked_price` field — server-side guard in `razorpay-webhook` refuses any price change for users with this flag.
