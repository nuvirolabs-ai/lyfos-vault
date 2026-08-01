# Contributing to Lyfos Vault

Thanks for helping improve Lyfos.

Lyfos Vault is a local-first, zero-knowledge family vault. This public repository is the Free Forever open-source version. The paid hosted Vault service remains private and commercial.

## What Belongs Here

Good contributions for this repository include:

- Bug fixes in the free vault experience.
- Privacy, accessibility, and usability improvements.
- Local-first storage and encryption hardening.
- Documentation that helps people run, understand, or self-host Lyfos.
- Tests that protect expected behavior.
- Small product improvements that fit the Free Forever boundary.

Please keep the product calm, minimal, and trust-focused. Avoid enterprise-style dashboards, long forms, or heavy workflows unless an issue clearly calls for them.

## What Does Not Belong Here

Do not submit:

- Production secrets, `.env` files, API keys, tokens, or private certificates.
- Real user data, real vault exports, or customer screenshots containing private information.
- Paid Vault service code, billing logic, commercial entitlement logic, or private release-service operations.
- Large unrelated rewrites or generated build output.

## Running Locally

Install dependencies:

```bash
npm install
```

Start the web app:

```bash
npm run dev:web
```

Run the web checks:

```bash
npm run check -w @os-one/web
```

Run tests:

```bash
npm test -w @os-one/web
```

## Pull Requests

Before opening a pull request:

1. Keep the change focused.
2. Add or update tests when behavior changes.
3. Make sure generated folders such as `apps/web/dist/` are not committed.
4. Explain the user impact in plain language.
5. Mention any security, privacy, or data-handling impact.

Maintainers may ask to split broad changes into smaller pull requests.

## Security Work

If you believe you found a vulnerability, do not open a public issue. Follow [SECURITY.md](SECURITY.md).
