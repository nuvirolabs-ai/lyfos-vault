# Waitlist & access

> **Current model: OPEN BETA.** Access is no longer gated. Every CTA on the
> marketing site links straight into the app (labelled "Beta"), and anyone can
> create a vault. The email form in `#join` is now an **optional founder-updates
> list**, not a gate — joining sends a friendly "welcome, your vault's ready"
> email (with the app link) instead of "you're #N in line".
>
> The pieces below still exist and work — the table just collects founder-member
> emails now, and the **admin page / activation flow is optional** (use it if you
> ever want to personally email a batch of signups). Nothing here gates the app.

The marketing site collects optional founding-member emails. The founder can
still email signups from the admin page; each "activation" emails the person
their app link. The product is open — the link is published on the site.

## Pieces

| Piece | Where | What it does |
|---|---|---|
| `waitlist` table | `supabase/migrations/0015_waitlist.sql` + `0016_waitlist_activation.sql` | Stores signups with `status` (`pending` / `activated`), `activated_at`, `note`. RLS fully locked — only service-role functions touch it. |
| `waitlist` function | `supabase/functions/waitlist/` | Public `POST {email, source}` — inserts a signup (deduped), returns the person's `position`, and emails a "you're on the list" confirmation (new non-checklist signups only). Also `GET` → `{ count }` for the live counter on the form. Called by the marketing form. |
| `waitlist-admin` function | `supabase/functions/waitlist-admin/` | Founder-only (`x-admin-token`). `GET` lists signups; `POST {action:"activate", id|email}` marks activated and emails the private app link via Resend. |
| Admin page | `apps/marketing/admin/` | Password-protected (the admin token). Lists signups, one-click **Activate & email**. `noindex`. |
| Marketing form | `apps/marketing/index.html` (`#join`) | All CTAs now point to `#join`; the form POSTs to the `waitlist` function. |

The **"~10 days"** wording is just messaging — there is no enforced waiting
period. You can activate anyone whenever you like. The admin page shows an
"eligible" tag after 10 days purely as a visual guide.

## One-time setup

### 1. Apply the migrations
In the Supabase SQL editor (or `supabase db push`), run `0015_waitlist.sql`
then `0016_waitlist_activation.sql` (0015 already exists if you applied it
earlier — 0016 is the new one).

### 2. Set function secrets
```bash
supabase secrets set \
  WAITLIST_ADMIN_TOKEN="$(openssl rand -hex 24)" \
  RESEND_API_KEY="re_…" \
  FROM_EMAIL="Lyfos <hello@lyfos.signorvale.com>" \
  APP_URL="https://lyfos.signorvale.com"
```
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
Keep the value of `WAITLIST_ADMIN_TOKEN` — it's the admin-page password.

### 3. Deploy the functions
```bash
supabase functions deploy waitlist       --no-verify-jwt   # public join
supabase functions deploy waitlist-admin  --no-verify-jwt   # auth'd via x-admin-token
```

### 4. Point the marketing form at the function
In `apps/marketing/index.html`, set the endpoint meta to your deployed URL:
```html
<meta name="lyfos-waitlist-endpoint"
      content="https://<project-ref>.supabase.co/functions/v1/waitlist" />
```
Commit + push — the landing site auto-deploys.

## Granting access (day-to-day)

1. Go to **`https://lyfoslanding.signorvale.com/admin/`**.
2. First visit: enter your **functions base URL**
   (`https://<project-ref>.supabase.co/functions/v1`) and the **admin token**.
   These are stored only in your browser.
3. You'll see **Pending** signups. Click **Activate & email** on anyone — they're
   marked `activated` and immediately receive their private app link.
4. "Disconnect" clears the token from this browser.

## Notes
- The **activation** email body lives in `waitlist-admin/index.ts` (`activationEmail`);
  the **"you're on the list" confirmation** email lives in `waitlist/index.ts`
  (`sendConfirmation`). Edit + redeploy to change copy.
- The confirmation email needs `RESEND_API_KEY` + `FROM_EMAIL` set on the
  `waitlist` function too (same values as the others). Without them, signups
  still work — they just don't get the confirmation.
- The form shows "N people are already on the waitlist" only once the count
  reaches 25 (so it never looks empty early). Tune the threshold in
  `apps/marketing/index.html` (the `c >= 25` check).
- Because RLS has no anon policies, the table can't be read or written by
  anyone except the two service-role functions — even with the anon key.
- The lead-magnet ("Family Recovery Checklist") form posts to the same
  `waitlist` function with `source: "checklist"`, so those land in the same
  table tagged differently.
