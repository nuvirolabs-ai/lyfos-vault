# Lyfos — Operator Setup

Step-by-step setup for the bits that live outside the codebase. Do these in order. None of the steps cost money on the free tiers; this is the bootstrap setup.

## 1. Supabase project (Phase 1 backend — accounts + zero-knowledge sync)

Lyfos uses Supabase for auth, Postgres, and (later) edge functions + storage. The free tier covers ~50k MAU and 500MB Postgres — more than enough for the beta.

### Create the project

1. Sign up at <https://app.supabase.com>.
2. Click **New project**.
3. Project name: `lyfos-prod` (or `lyfos-dev` for a sandbox).
4. Database password: generate a strong one with a password manager and save it — used for direct SQL access only.
5. **Region: South Asia (Mumbai)** — DPDPA-friendly for India launch. Use a different region only if your first users are elsewhere.
6. Plan: Free (you can upgrade later).
7. Wait ~2 minutes for provisioning.

### Apply the schema

1. In the Supabase dashboard sidebar: **SQL Editor → New query**.
2. Paste the contents of `supabase/migrations/0001_initial_schema.sql`. Run.
3. Repeat with `supabase/migrations/0002_rls_policies.sql`. Run.
4. Repeat with `supabase/migrations/0003_account_deletion.sql`. Run.
5. **0004_monthly_reminder_cron.sql** — do NOT run yet. Run after deploying the Edge Function (see step "Monthly reminder email" below).
6. Apply `0005_release_engine.sql`. Run.
7. Apply `0006_release_engine_rls.sql`. Run.
8. Apply `0007_invite_helpers.sql`. Run.
9. Apply `0008_release_claim_flow.sql`. Run. (Creates storage buckets `death_certificates` + `release_downloads`.)
10. `0009_release_alert_cron.sql` — do NOT run yet. Run after deploying the release-alert-dispatcher Edge Function (see step "Multi-channel release alerts" below).
11. Apply `0010_nominee_combine.sql`. Run.
12. Apply `0011_subscriptions.sql`. Run.
13. Apply `0012_invoices_setup.sql`. Run. (Creates the `invoices` storage bucket + the `allocate_invoice_number` RPC.)
12. Verify in **Table editor**: you should see `vault_blobs`, `devices`, `recovery_envelopes`, `audit_log`, `key_holders`, `key_shares`, `release_requests`, `release_share_releases`, `release_alerts`, `release_settings`. All should have the green "RLS enabled" badge. In **Database → Functions** you should see `append_audit_event`, `delete_account`, `admin_approve_release`, `admin_reject_release`, `owner_abort_release`, `holder_release_share`, `maybe_start_hold`, `maybe_complete_hold`, `peek_invite`, `accept_invite`, `mark_holder_verified`, `peek_claim`, `create_release_request`, `admin_list_pending_releases`, `admin_get_certificate_url`, `nominee_get_vault_blob`, `nominee_mark_completed`.

#### Founder admin role

Phase 3's release-claim review queue identifies admins by a `role` claim in `auth.users.raw_user_meta_data`. To make yourself an admin (no UI for this yet, by design — admin grants are deliberate):

```sql
update auth.users
   set raw_user_meta_data = raw_user_meta_data || '{"role":"admin"}'::jsonb
 where email = 'your-founder-email@lyfos.signorvale.com';
```

### Configure auth providers

1. **Authentication → Providers → Email**: enable Email. Enable **Confirm email** so signups must verify the address before logging in.
2. **Authentication → URL Configuration**:
   - Site URL: `https://lyfos.signorvale.com` (production)
   - Redirect URLs: add `http://127.0.0.1:5173/` and `http://localhost:5173/` for local dev.
3. **Authentication → Email Templates**: edit the "Confirm signup" and "Magic link" emails to match Lyfos voice. The default Supabase template is fine for the beta; tighten before launch.

### Get the API keys

1. **Project Settings → API**.
2. Copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`) → goes into `VITE_SUPABASE_URL`.
   - **anon / public key** → goes into `VITE_SUPABASE_ANON_KEY`.

The **service_role** key is also on that page — DO NOT put it in the web app or git. It bypasses Row Level Security and is for server-side jobs only.

### Local dev

1. Copy `apps/web/.env.example` to `apps/web/.env.local`.
2. Paste the URL and anon key into the two `VITE_SUPABASE_*` lines.
3. `npm run dev:web` and you should now see the auth screens.

### Production deploy env

Wherever lyfos.signorvale.com is hosted (Cloudflare Pages, Vercel, Netlify), add the same two env vars in the project settings. Redeploy.

---

## 2. Monthly reminder email (Phase 2)

Sends the calm "Five minutes for January numbers" email on the 1st of each month to users who haven't pushed an update yet that month. Email goes through Resend.

### One-time setup

1. **Sign up for Resend** at <https://resend.com> (free tier: 100 emails/day, plenty for the beta).
2. Verify your sending domain (e.g. `lyfos.signorvale.com`) by adding the DNS records Resend gives you. Without this, emails will hit spam.
3. Create an API key in Resend (Project → API Keys). Keep it private.

### Install the Supabase CLI on your machine

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>   # find in Project Settings → General
```

### Deploy the Edge Function

```bash
cd supabase
supabase functions deploy monthly-reminder
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxxxx
supabase secrets set FROM_EMAIL="Lyfos <hello@lyfos.signorvale.com>"
supabase secrets set APP_URL="https://lyfos.signorvale.com"
```

### Schedule it

1. In the Supabase dashboard: **Database → Extensions**. Enable **pg_cron** and **pg_net**.
2. In **Project Settings → Database**, find your Postgres URL. Then in **SQL Editor**, run:
   ```sql
   alter database postgres set "app.settings.supabase_url" = 'https://<your-ref>.supabase.co';
   alter database postgres set "app.settings.cron_bearer" = '<your-service-role-key>';
   ```
   (The service-role key is in **Project Settings → API**. Keep it out of git.)
3. Now run `supabase/migrations/0004_monthly_reminder_cron.sql` in the SQL Editor.
4. Verify with: `select * from cron.job where jobname = 'lyfos-monthly-reminder';`

### Test it without waiting until the 1st

```bash
# From your local machine, invoke the function manually
curl -X POST \
  "https://<your-ref>.supabase.co/functions/v1/monthly-reminder" \
  -H "Authorization: Bearer <your-service-role-key>"
```

You should get back `{"ok": true, "sent": N, "failed": 0, "monthLabel": "..."}`.

---

## 3. Release engine Edge Functions (Phase 3)

Three Edge Functions ship the release engine. Deploy them after applying the SQL migrations.

```bash
cd supabase
supabase functions deploy send-key-holder-invite
supabase functions deploy release-alert-dispatcher
```

The `send-key-holder-invite` function reuses your Resend secrets from the monthly reminder.

### Multi-channel release alerts

The `release-alert-dispatcher` fires hourly during the 14-day owner-protection hold and sends one alert per channel per UTC day. To enable each channel:

**Email — always on if Resend is configured.** No extra setup beyond the monthly-reminder Resend keys.

**SMS via MSG91** (India). Sign up at <https://msg91.com>, get an auth key, and create a DLT-approved template that takes 2 placeholders: `{{var1}}` (days remaining) and `{{var2}}` (abort URL).

```bash
supabase secrets set \
  MSG91_AUTH_KEY=… \
  MSG91_TEMPLATE_ID=… \
  MSG91_SENDER_ID=LYFOSV
```

If `MSG91_AUTH_KEY` is unset, SMS gracefully skips.

**WhatsApp via Meta Cloud API**. Apply for WhatsApp Business via Meta Business Suite (allow 2–3 weeks). Create an approved template called `lyfos_release_hold` that accepts one body parameter (days remaining).

```bash
supabase secrets set \
  WHATSAPP_TOKEN=EAA… \
  WHATSAPP_PHONE_NUMBER_ID=… \
  WHATSAPP_TEMPLATE_NAME=lyfos_release_hold
```

If `WHATSAPP_TOKEN` is unset, WhatsApp gracefully skips.

### Schedule the dispatcher

Once `release-alert-dispatcher` is deployed:

1. Make sure `app.settings.supabase_url` + `app.settings.cron_bearer` are set (you did this for the monthly reminder).
2. Run `supabase/migrations/0009_release_alert_cron.sql` in the SQL editor. This schedules the dispatcher hourly at minute 7.
3. Manual test:
   ```bash
   curl -X POST "https://<your-ref>.supabase.co/functions/v1/release-alert-dispatcher" \
     -H "Authorization: Bearer <service-role-key>"
   ```
   Expected: `{"ok":true, "holding":0, "channels":0, "expired":0, "errors":[]}` on a quiet system.

### End-to-end death-simulation runbook

Before opening the release feature to paying users, run the full simulation documented in `docs/death-simulation-runbook.md`. 7 throwaway emails, ~20 minutes of work, proves the entire chain works. Run it again quarterly.

---

## 4. Payments (Phase 4 — Razorpay + GST invoices)

### Razorpay setup

1. Sign up at <https://razorpay.com> and complete KYC. Your sending domain needs to be added.
2. **Subscriptions → Plans → + New plan:**
   - Plan 1: `Lyfos Vault — yearly`, billing cycle 1 year, amount **99900 paise (₹999)**.
   - Plan 2: `Lyfos Family — yearly`, billing cycle 1 year, amount **249900 paise (₹2,499)**.
   Note the `plan_xxx` IDs.
3. **Settings → Webhooks → + Add new webhook:**
   - URL: `https://<your-ref>.supabase.co/functions/v1/razorpay-webhook`
   - Active events: `subscription.activated`, `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `payment.failed`
   - Secret: generate a strong value, you'll set it as `RAZORPAY_WEBHOOK_SECRET`.
4. **Settings → API Keys → Generate Live Key.** Save Key ID + Secret.

### Deploy the payment Edge Functions

```bash
cd supabase
supabase functions deploy create-checkout-session
supabase functions deploy razorpay-webhook
supabase functions deploy cancel-subscription
supabase functions deploy resume-subscription
supabase functions deploy generate-invoice

supabase secrets set \
  RAZORPAY_KEY_ID=rzp_live_xxx \
  RAZORPAY_KEY_SECRET=xxx \
  RAZORPAY_PLAN_VAULT=plan_xxx \
  RAZORPAY_PLAN_FAMILY=plan_xxx \
  RAZORPAY_WEBHOOK_SECRET=xxx \
  LYFOS_GSTIN=27AABCU1234D1Z5 \
  LYFOS_LEGAL_NAME="Your Company Pvt Ltd" \
  LYFOS_ADDRESS="Your registered address" \
  LYFOS_STATE_CODE=27 \
  LYFOS_PAN=AABCU1234D
```

### Stripe (optional, off by default)

Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_VAULT`, `STRIPE_PRICE_FAMILY` only when you're ready to start charging in USD. Leaving them unset keeps Stripe inert; Razorpay remains the active path.

### Smoke test

In the app, sign in as a test user, open Settings → Billing → Upgrade. Choose Vault. The button should redirect to Razorpay's hosted checkout (`short_url`). Use Razorpay's test cards (`4111 1111 1111 1111` etc.) in test mode. After payment, the webhook fires `subscription.activated`, the `subscriptions` row flips to `active`, the invoice generator creates an HTML invoice at `invoices/<user_id>/LYF-YYYY-NNNNNN.html`. The Billing → Invoices list shows the new row.

If anything errors:
- Check the webhook delivery log in Razorpay dashboard.
- Check the Edge Function logs in Supabase dashboard → Functions.
- Use `select * from billing_events where user_id = '<id>' order by created_at desc;` to see what landed.

### GST registration

You need a GSTIN once your annual revenue exceeds ₹20L (₹10L for special-category states). Until then, the invoice can be issued without a GSTIN — but you cannot collect GST. We default to applying 18% GST in `generate-invoice` because once you're paid that's correct; if you're below the threshold, edit the function to drop the tax math and label invoices "GST not applicable (below threshold)" until registration.

---

## 5. Plausible Analytics (Phase 0 telemetry)

Free for personal projects with public dashboards; paid tier ($9/mo) for private dashboards. For a vault product, **use the paid tier** so usage analytics aren't publicly indexable.

1. Sign up at <https://plausible.io>.
2. **+ Add a website**.
3. Domain: `lyfos.signorvale.com`.
4. Timezone: Asia/Kolkata.
5. Skip the script-installation step — Lyfos injects the script automatically when the env var is set.
6. Add `VITE_PLAUSIBLE_DOMAIN=lyfos.signorvale.com` to the deploy env.
7. Redeploy. Visit the site, then check the Plausible dashboard ~30 seconds later — you should see the page view.

---

## 6. Sentry (error monitoring — wire up after Phase 1)

Skip for now. The code path is ready in `apps/web/src/lib/telemetry.js`. When you decide to enable:

1. Sign up at <https://sentry.io>. Free tier: 5k errors/month.
2. Create a project: platform = **Browser / React**.
3. Copy the DSN.
4. In the repo: `cd apps/web && npm install @sentry/browser`.
5. Uncomment the `import("@sentry/browser")` block in `apps/web/src/lib/telemetry.js`.
6. Add `VITE_SENTRY_DSN=...` to the deploy env.

---

## 7. Hosting security headers (Phase 0 closeout)

Wherever you deploy (Cloudflare Pages recommended for free India edge), add response headers:

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://plausible.io; connect-src 'self' https://*.supabase.co https://plausible.io; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

On Cloudflare Pages: project → Settings → Headers → add a `_headers` file in the deployed bundle. We can ship that file from `apps/web/public/_headers` when you commit to a host — let me know which host you pick.

---

## 8. Domain ownership

The repo references `lyfos.signorvale.com`. When you migrate to a primary domain (e.g. `lyfos.com` or `lyfos.app`):

1. Buy via Cloudflare Registrar (cheapest, no markup, DNSSEC included).
2. Update the redirect URLs in Supabase auth.
3. Update `apps/web/public/legal/*.html` references.
4. Update `ROADMAP.md` and `README.md`.

Not urgent — `lyfos.signorvale.com` is fine for the beta.


---

## 9. Phase 6 — Compliance, security, trust (operator-side)

These are the non-code items needed before public launch. Most cost money or take real-world time. Code-side artefacts are already in the repo under `docs/security/`, `docs/compliance/`, and `docs/runbooks/`.

### 9.1 Security audit (~₹2L)

Engage **Payatu** (or alternative — see `docs/security/audit-prep-checklist.md`) for a pre-launch audit. Plus an independent academic crypto review for the release engine + Shamir + Curve25519. Six-week window, no shipping during the audit. Hand them `docs/security/threat-model.md` and `docs/security/audit-prep-checklist.md` on day one. Re-test must pass before public launch.

### 9.2 Cyber liability insurance (~₹40k-₹1.2L/year)

Quote via **PolicyBazaar for Business** or **Marsh India**. Target aggregate ₹5-7 crore (see `docs/compliance/cyber-insurance-procurement.md` for sub-limits + provider comparison). Application packet template included; pull from threat model + audit prep checklist. Sign + pay first premium 2 weeks before launch.

### 9.3 PGP key for security mailbox

```bash
gpg --quick-generate-key "Lyfos Security <security@lyfos.signorvale.com>" rsa4096 default 2y
gpg --armor --export security@lyfos.signorvale.com > apps/web/public/.well-known/pgp-key.txt
```

Commit + redeploy. Replaces the placeholder at `/.well-known/pgp-key.txt`.

### 9.4 Status page

A minimal static page is already at `apps/web/public/status/index.html`. To declare an incident, edit that file by hand — see `docs/runbooks/status-page-update.md`. When > 500 paid users, move to **Instatus** (~$20/month).

### 9.5 DPDPA grievance officer + sub-processor page

The privacy page now lists the grievance officer email `grievance@lyfos.signorvale.com` (forward this to founder mailbox). Sub-processor list at `/legal/sub-processors.html`. Both are mandatory. Hindi translation of privacy page still to-do.

### 9.6 Continuity envelope

Print + seal the credentials envelope per `docs/runbooks/founder-bus-factor.md`. Identify and brief the primary + secondary backup operators. Place in a fireproof safe at the founder's primary residence.

### 9.7 Bug bounty

Programme published at `/security/bug-bounty`. Funding line: budget ₹2L/year for payouts during year one. Track received reports in `docs/security/hall-of-fame.md` and the public mirror.

### 9.8 Open items tracker

Living checklist at `docs/runbooks/open-issues.md`. Cross items off as they ship. Review at every Phase 7 milestone.

### 9.9 Customer support setup

Set up the inbound aliases in your domain MX (or Google Workspace / Zoho Mail):

| Alias                                    | Forwards to              |
|------------------------------------------|--------------------------|
| help@lyfos.signorvale.com                | founder mailbox          |
| security@lyfos.signorvale.com            | founder mailbox + Slack alert |
| grievance@lyfos.signorvale.com           | founder mailbox          |
| press@lyfos.signorvale.com               | founder mailbox          |
| status@lyfos.signorvale.com              | Mailing-list provider (ConvertKit / Substack) |
| founder@lyfos.signorvale.com             | founder mailbox          |
| legal@lyfos.signorvale.com               | founder mailbox          |

SLA published at `docs/compliance/customer-support-sla.md`.

