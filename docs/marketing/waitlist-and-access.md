# Waitlist & gated access

Instead of linking straight into the product, the marketing site now collects a
**waitlist**. The founder grants access in batches from an admin page; each
activation emails the person their **private** app link. The product itself is
**soft-gated** — it stays open to anyone who has the link, but the link is only
ever sent in the activation email (never published on the site).

## Pieces

| Piece | Where | What it does |
|---|---|---|
| `waitlist` table | `supabase/migrations/0015_waitlist.sql` + `0016_waitlist_activation.sql` | Stores signups with `status` (`pending` / `activated`), `activated_at`, `note`. RLS fully locked — only service-role functions touch it. |
| `waitlist` function | `supabase/functions/waitlist/` | Public `POST {email, source}` — inserts a signup (deduped). Called by the marketing form. |
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
- The activation email body lives in `waitlist-admin/index.ts` (`activationEmail`).
  Edit + redeploy to change the copy or the link.
- Because RLS has no anon policies, the table can't be read or written by
  anyone except the two service-role functions — even with the anon key.
- The lead-magnet ("Family Recovery Checklist") form posts to the same
  `waitlist` function with `source: "checklist"`, so those land in the same
  table tagged differently.
