# Lyfos Vault

Lyfos is a local-first, zero-knowledge family vault for the records, money notes, IDs, insurance details, and recovery instructions a family may need one day.

This repository is the **Free Forever** version: open source, self-hostable, and designed to run locally without paid infrastructure. The hosted free product is limited to 11 vault entries.

The **Paid Vault** is Nuviro Labs' private commercial version. Paid-only capabilities such as unlimited entries, personal balance sheet, cloud release workflow, and Circle of Trust release service launch separately.

Repository: https://github.com/nuvirolabs-ai/lyfos-vault

## What Is Open Source

- Local-first encrypted vault experience.
- Free Forever product surface.
- Static marketing site and product app source.
- Local development and self-hosting path.

## What Stays Private

- Paid Vault release service.
- Commercial billing and paid entitlement logic.
- Production operations, private keys, and hosted Supabase/Vercel credentials.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the web app:

```bash
npm run dev:web
```

Run checks:

```bash
npm run check -w @os-one/web
```

For connected auth, sync, waitlist, and email behavior, see [SELF_HOSTING.md](SELF_HOSTING.md).

## Environment

Copy `apps/web/.env.example` when you want connected auth, sync, waitlist, or email behavior. Without production Supabase credentials, the free app should remain usable for local-only testing.

Production secrets must stay outside Git. Do not commit `.env`, Supabase service-role keys, Resend keys, Razorpay keys, or Vercel tokens.

## Security Boundary

- Vault contents are encrypted before browser storage.
- Cloud sync and release features require correctly configured Supabase and Edge Functions.
- This code still needs independent security review before being marketed for high-risk legal, medical, or financial custody.

## Public Launch Notes

Before making the repository public, choose and add a license. For an open-core product where the hosted paid service remains private, AGPL-3.0 is a common starting point, but confirm with legal counsel before publishing.
