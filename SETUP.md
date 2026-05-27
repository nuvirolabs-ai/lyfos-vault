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
8. Verify in **Table editor**: you should see `vault_blobs`, `devices`, `recovery_envelopes`, `audit_log`, `key_holders`, `key_shares`, `release_requests`, `release_share_releases`, `release_alerts`. All should have the green "RLS enabled" badge. In **Database → Functions** you should see `append_audit_event`, `delete_account`, `admin_approve_release`, `admin_reject_release`, `owner_abort_release`, `holder_release_share`, `maybe_start_hold`, `maybe_complete_hold`.

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

## 3. Plausible Analytics (Phase 0 telemetry)

Free for personal projects with public dashboards; paid tier ($9/mo) for private dashboards. For a vault product, **use the paid tier** so usage analytics aren't publicly indexable.

1. Sign up at <https://plausible.io>.
2. **+ Add a website**.
3. Domain: `lyfos.signorvale.com`.
4. Timezone: Asia/Kolkata.
5. Skip the script-installation step — Lyfos injects the script automatically when the env var is set.
6. Add `VITE_PLAUSIBLE_DOMAIN=lyfos.signorvale.com` to the deploy env.
7. Redeploy. Visit the site, then check the Plausible dashboard ~30 seconds later — you should see the page view.

---

## 4. Sentry (error monitoring — wire up after Phase 1)

Skip for now. The code path is ready in `apps/web/src/lib/telemetry.js`. When you decide to enable:

1. Sign up at <https://sentry.io>. Free tier: 5k errors/month.
2. Create a project: platform = **Browser / React**.
3. Copy the DSN.
4. In the repo: `cd apps/web && npm install @sentry/browser`.
5. Uncomment the `import("@sentry/browser")` block in `apps/web/src/lib/telemetry.js`.
6. Add `VITE_SENTRY_DSN=...` to the deploy env.

---

## 5. Hosting security headers (Phase 0 closeout)

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

## 6. Domain ownership

The repo references `lyfos.signorvale.com`. When you migrate to a primary domain (e.g. `lyfos.com` or `lyfos.app`):

1. Buy via Cloudflare Registrar (cheapest, no markup, DNSSEC included).
2. Update the redirect URLs in Supabase auth.
3. Update `apps/web/public/legal/*.html` references.
4. Update `ROADMAP.md` and `README.md`.

Not urgent — `lyfos.signorvale.com` is fine for the beta.
