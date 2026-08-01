# Self-Hosting Lyfos Vault

This guide is for running the open-source Free Forever version of Lyfos Vault.

The public repository does not include Nuviro Labs' private paid Vault service, production credentials, billing operations, or hosted release-service operations.

## Local-Only Mode

Local-only mode is the safest starting point. It does not require Supabase, Resend, Razorpay, or Vercel.

```bash
npm install
npm run dev:web
```

Open the local URL printed by Vite.

Without cloud environment variables, Lyfos should remain usable for local vault testing. Data stays in browser storage on that device.

## Connected Mode

Connected mode adds auth, encrypted sync, waitlist capture, and Edge Functions. You need your own Supabase project and your own provider keys.

### Supabase

1. Create a Supabase project.
2. Apply the SQL files in `supabase/migrations/` in order.
3. Configure Supabase Auth email sign-in.
4. Add your app URL to Supabase Auth redirect URLs.
5. Copy your Supabase project URL and anon/public key.

For local web development, create `apps/web/.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_APP_URL=http://127.0.0.1:5173
```

The anon key is public by design. Never put the Supabase service-role key in frontend code.

### Edge Function Secrets

Set secrets in Supabase, not in Git:

```bash
supabase secrets set RESEND_API_KEY=your-resend-key
supabase secrets set FROM_EMAIL="Lyfos <hello@your-domain.com>"
supabase secrets set APP_URL="https://your-app-domain.com"
```

Only server-side functions should read provider secrets.

### Email

If you use Resend, verify a sending domain you control and add the DNS records Resend gives you. For local testing, you can still use direct invite links when email is not configured.

### Payments

The public Free Forever repository does not require payments. If you experiment with billing code, use test-mode credentials only and keep all secrets outside Git.

## Deployment

You can deploy the web app to any static host that supports Vite builds.

```bash
npm run build -w @os-one/web
```

Deploy `apps/web/dist/` from the generated build output.

The marketing site is static HTML in `apps/marketing/`.

## Security Rules

- Do not commit `.env` files.
- Do not commit Supabase service-role keys.
- Do not commit Resend, Razorpay, Vercel, or other provider tokens.
- Do not test with real sensitive vault data until you understand the security boundary.
- Use your own Supabase project for self-hosting.

## Open Source Boundary

Included here:

- Free Forever vault source.
- Local-first encrypted vault behavior.
- Public Supabase migrations and Edge Function source.
- Static marketing pages.

Not included here:

- Nuviro Labs production credentials.
- Private paid Vault operations.
- Commercial billing operations.
- Private infrastructure configuration.
