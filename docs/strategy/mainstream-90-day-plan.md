# Mainstream: the 90-day plan

The CEO-level diagnosis (June 2026): Lyfos is a beautifully engineered
"someday" product. Three things stand between it and mainstream:

1. **A weekly habit** — today's honest loop is "set up once, feel relieved,
   never return." The monthly balance sheet is the trojan horse.
2. **Trust infrastructure** that matches the ask — you're asking for someone's
   will and passwords; architecture alone doesn't convert non-experts.
3. **Distribution built into the product** — nobody Googles "death vault";
   the 5-holders-plus-nominee structure *is* the growth loop.

## Already shipped (code-side, June 11 2026)

| Item | Where |
|---|---|
| Money-ritual repositioning (hero subhead + "monthly ritual" section) | `apps/marketing/index.html` |
| Beta time-boxed: "1.0 ships September 2026" on the homepage | `apps/marketing/index.html` |
| Continuity Charter (the "what if Lyfos dies first" page) | `apps/marketing/continuity/` |
| "Independent audit scheduled" removed from the trust strip (→ continuity link) | homepage |
| "Coming soon / on the way" phrases purged from marketing | homepage |
| Family plan as the hero SKU (₹2,499/yr, featured card) | homepage pricing |
| Recovery dry-run in onboarding (Home card + tour step "Preview the promise") | `apps/web/src/main.jsx` |
| WhatsApp invite sharing for key-holders (create + remind) | `apps/web/src/main.jsx` |
| Sync-by-default nudge ("this vault lives only in this browser") | `apps/web/src/main.jsx` |
| Demo data gated behind `?demo=1` (out of the normal bundle/UX) | `apps/web/src/main.jsx` |
| Waitlist admin page + `waitlist-admin` function deleted (vestiges) | removed |

## Days 1–30 — Trust (owner actions)

- [ ] **Founder goes public.** Real name, real photo, the nine-months story in
      first person, replacing the "SV" placeholder section on the homepage.
      Non-negotiable for this category. (I can wire it in within minutes of
      getting the name/photo.)
- [ ] **Commission the security audit** (Cure53 / Trail of Bits / an Indian
      CERT-In-empanelled firm). Say nothing until signed; publish the report in
      full when done. The Trust Center already promises this honestly.
- [ ] **Open-source the crypto client** (flip `packages/crypto` + the vault
      client to a public repo) — backs the Continuity Charter's commitment.
- [ ] **Create the Plausible account** for `lyfoslanding.signorvale.com`
      (tracker is wired; events drop until the site exists there).

## Days 31–60 — Habit

- [x] Reposition homepage around the money ritual (shipped).
- [x] Dry-run into onboarding (shipped).
- [ ] Make the monthly check-in the notification spine: deploy the
      `monthly-reminder` Edge Function + cron (see SETUP.md) so the 1st-of-month
      nudge actually fires.
- [ ] Streaks: surface "N months in a row" in the check-in ritual (small code
      task, high habit value).

## Days 61–90 — Loops

- [x] WhatsApp holder invites (shipped).
- [x] Family plan as hero SKU on marketing (shipped); wire the actual
      Razorpay Family plan SKU in the product when billing reopens post-beta.
- [ ] **CA / financial-advisor referral pilot**: 20 chartered accountants, each
      gets a co-branded Family Recovery Checklist + a referral code. The PDF
      lead magnet already exists at `/family-recovery-checklist.pdf`.
- [ ] **App stores**: submit the Expo iOS/Android builds (`apps/mobile/`,
      EAS configs in repo). A life-critical product only in a browser tab
      feels temporary.
- [ ] **Announce the 1.0 date publicly** (September 2026 — already on the
      site) and treat leaving beta as a launch event: audit published,
      founder public, apps in stores.

## The sentence that defines "perfect"

> A household opens Lyfos every month to watch their net worth — and sleeps
> well because of what they never have to open.

Everything above is engineering that sentence.
