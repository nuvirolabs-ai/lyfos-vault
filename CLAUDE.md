# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Lyfos Vault** (internal name "OS-One Vault") — a zero-knowledge, client-encrypted vault for sensitive records + a monthly personal balance sheet. The product thesis: turn scattered private records into protected, rule-based life recovery so a nominee can actually recover after death/incapacity, without ever trusting the company.

**Current state (Phase 5 complete — backend + payments + mobile shipped, audit still ahead):** local-first encrypted vault, optional cloud sync, accounts, multi-device, multi-currency balance sheet, full release engine (Shamir SSS + X25519 + 14-day hold + multi-channel alerts including mobile push + nominee combine), Razorpay subscriptions with GST-compliant tax invoices, free-tier gating (10 vault items, no release plan on free), iOS + Android apps via Expo SDK 52 with Face ID / Touch ID unlock and Universal Links into the same release routes. All of this activates when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (web) / `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (mobile) are set at build time + the SQL migrations are applied. See [ROADMAP.md](ROADMAP.md), [SETUP.md](SETUP.md), [apps/mobile/README.md](apps/mobile/README.md), and [docs/death-simulation-runbook.md](docs/death-simulation-runbook.md).

Deployed at https://lyfos.signorvale.com. Repo: https://github.com/signorvaleai-hash/lyfos-vault.

## Commands

```bash
npm run dev:web              # vite dev server on http://127.0.0.1:5173
npm run dev:backend          # node http server on http://127.0.0.1:4317 (stub, mostly unused)
npm run check                # run check in every workspace (vite build for web)
npm run package:web          # build + zip a static deployable to build/os-one-vault-web.zip
```

Inside `apps/web/`:

```bash
npm run dev                  # same as root dev:web
npm run build                # vite build to apps/web/dist/
npm run preview              # serve the built bundle
npm test                     # node --test on src/lib/*.test.js
node --test src/lib/stage1Audit.test.js   # run a single test file
```

There is no linter and no CI configured yet (both are in Phase 0 of the roadmap).

## Architecture

### Monorepo layout

npm workspaces, two app entry points and two shared packages:

- `apps/web/` — the **product** (React 18 + Vite 7 + Tailwind v4). This is what users see. **The entire UI lives in a single ~3.5k-line file: [apps/web/src/main.jsx](apps/web/src/main.jsx).** Treat that file as the application — components are not split out.
- `apps/backend/` — 75-line Node http server stub. Largely superseded by Supabase (see `supabase/migrations/`). Kept for reference; not part of the production stack.
- `supabase/migrations/` — SQL migrations. Apply in order via the Supabase SQL editor or the supabase CLI: `0001_initial_schema.sql`, `0002_rls_policies.sql`, `0003_account_deletion.sql`, `0004_monthly_reminder_cron.sql` (only after deploying the Edge Function — see SETUP.md).
- `supabase/functions/` — Edge Functions. `monthly-reminder/` sends the calm 1st-of-month nudge to users whose `vault_blobs.client_updated_at` predates the current month. Uses Resend; reads `RESEND_API_KEY` / `FROM_EMAIL` / `APP_URL` from secrets.
- `apps/mobile/` — React Native + Expo SDK 52, iOS + Android. Bottom-tab IA (Home / Vault) + modal Settings + public deep-link routes (`/invite`, `/claim`, `/release/abort`, `/hold-release`, `/download`, `/admin`). Shares the same Supabase backend and wire-compatible crypto with web — a holder who accepted on web can release on mobile. See `apps/mobile/README.md`.
- `apps/app/` — Tauri desktop scaffold (not active).
- `packages/crypto/` — WebCrypto primitives: PBKDF2 (600k iterations, SHA-256) → AES-GCM-256. Plain ESM, no dependencies.
- `packages/vault-model/` — pure data: vault item types and release policy constants. Imported by both `apps/web` and `apps/backend`.

### Vault data model

The vault is one JSON object, encrypted as a single blob with the user's derived key and persisted to `localStorage` under `os-one-vault-record-v1`. Shape:

```
{
  version: 1,
  items: [/* records: passwords, IDs, bank accounts, etc. */],
  balanceSheet: { accounts: [...], snapshots: [...] },   // monthly net worth ledger
  releaseSettings: { mainNominee, keyHolders, emergencyOnly },
  audit: [/* append-only event log */]
}
```

When you add a new top-level field, no migration is needed — unknown fields ride through encryption transparently. But **never drop or rename existing fields** without writing a migration in `createEmptyVault`/load path, or you'll silently corrupt user data on next save.

### Crypto boundary

Everything goes through `packages/crypto`:

- `deriveVaultKey(passphrase, salt)` — PBKDF2 → AES-GCM key (non-extractable).
- `encryptJson(key, value)` / `decryptJson(key, encrypted)` — JSON-in, base64 envelope out.
- `randomSalt(bytes)` — uses `crypto.getRandomValues`.

In `main.jsx`, `persistVault(key, vault, recordMeta)` is the single funnel for writing — every state change that should survive a refresh must go through it. Never write to `localStorage` directly from a component.

**Argon2id is the default KDF for new vaults** (`apps/web/src/lib/argon2.js` wraps hash-wasm). Legacy PBKDF2-600k vaults still unlock — `stage1Crypto.js` dispatches on `envelope.kdf.name`. On a successful unlock, the matching envelope is auto-upgraded to Argon2id via `upgradeEnvelopeKdf` (best-effort, only the envelope whose secret is in memory).

**Recovery phrase is BIP39 24-word** (`apps/web/src/lib/recoveryPhrase.js` via `@scure/bip39`). Legacy `OS1A-XXXX-...` keys still work — `normalizeRecoveryKey` detects the format. The `generateLegacyRecoveryKey` export remains for tests that need the old shape.

### Cloud sync (Phase 1)

- `apps/web/src/lib/supabaseClient.js` — lazy `createClient`, env-driven. `getSupabase()` returns `null` if env vars are unset; every call site is null-safe.
- `apps/web/src/lib/auth.js` — sign-up / sign-in / magic link / sign-out / `deleteAccount` / device-token + server audit helpers.
- `apps/web/src/lib/vaultSync.js` — `pushEncryptedRecord` / `fetchEncryptedRecord` / `reconcileLocalAndServer` (last-write-wins by `updatedAt`) / device registry.
- `apps/web/src/AuthScreen.jsx` — separate file because it's a top-level screen. Renders only when Supabase is configured AND there is no local record AND no session (or when user explicitly opens it via Settings).
- Push happens fire-and-forget from `saveVault` after a successful local persist. Pull happens once per session arrival in a `useEffect([session?.user?.id])`.

### Storage helpers (`apps/web/src/lib/`)

Split into stage1 (foundational vault) and stage2 (backup health & recovery key features):

- `stage1Store.js` — localStorage IO for the vault record and backup health blob.
- `stage1Session.js` — auto-lock policy + audit event buffering across reloads.
- `stage1Crypto.js`, `stage1Audit.js`, `stage1Attachments.js` — vault primitives layered over `@os-one/crypto`.
- `stage2*` — backup verification, manifest, reminders, recovery key, restore preview.

Every `.js` here has a sibling `.test.js` (node --test). When adding logic, follow the pattern: pure function in lib/, test next to it.

### UI architecture inside `main.jsx`

The file is organized top-to-bottom roughly as:

1. **Constants, EMPTY_ITEM, type lists, balance-sheet categories**
2. **`createEmptyVault` / `createDemoVault` / `createEmptyBalanceSheet` / `createDemoBalanceSheet`**
3. **Vault primitives** — `persistVault`, attachment helpers, audit append, life-model derivation
4. **Heuristic extractors** — `analyzeMessyInput`, `analyzeMessyInputRecords` (regex-based, runs client-side; the OCR uses `tesseract.js`)
5. **App shell** — `App` (root state machine: locked / unlocked), `EntryScreen` (passphrase + restore + recovery key UI), `VaultExperience` (the unlocked shell)
6. **Top-level screens** — `HomeScreen`, `SetupScreen`, `UpdateScreen` (the new balance-sheet trio), `LifeMapScreen`, `CategoryWorkspace`, `CaptureScreen`, `ReleaseScreen`
7. **Leaf components** — sparkline, breakdown rows, draft rows, release stat, signal pill, security panel, audit trail, backup verification, recovery key replace, etc.

`VaultExperience` is the top nav state machine. Two primary tabs (Home, Vault). Inside Vault, a sub-nav switches between Life Map / Capture / Release. The `screen` string drives everything.

### Design system

- Tailwind v4, no separate config — utilities used inline with arbitrary values (`text-[44px]`, `bg-[#fbfbfd]`).
- Background `#fbfbfd`, surface `#ffffff`, primary text `#1d1d1f`, secondary `#6e6e73`, tertiary `#86868b`, muted `#a1a1a6`, divider `#000/8`.
- Status: green `#34c759` / `#0b6b3a`, amber `#c88719` / `#7a4b00`, red `#d70015` / `#b42318`.
- Typography hierarchy: 64–80px hero numbers, 36–44px screen titles, 20–26px section titles, 13–15px body, 11–12px labels with `tracking-[0.18em]` uppercase for micro-labels.
- Rounded `2xl` (16px) for cards, full pill for buttons + nav, `xl` (12px) for inputs.
- One subject per screen. No two-column "billboard + tool" layouts (we removed those in the recent redesign — do not reintroduce).

## Known sharp edges

- **The Release tab is a draft, not a feature.** It saves locally and simulates readiness. There is no email, no nominee verification, no 14-day hold, no actual release. UI must continue to make this brutally clear until Phase 3 of the roadmap ships.
- **`dist/` is committed.** This repo deploys static files directly; the built bundle in `apps/web/dist/` is part of git on purpose (for now). When you change `main.jsx`, also commit the rebuilt `dist/assets/index-*.js` and `dist/assets/index-*.css` (vite hashes the filenames so old ones get deleted).
- **Demo data is in the production bundle.** `createDemoVault()` ships realistic-looking Indian banking data ("HDFC primary account", "rahul.sharma@example.com", "IFSC HDFC0001234"). Phase 0 moves this behind a `?demo=1` flag.
- **localStorage is the only persistence.** Clearing browser data destroys the vault. Phase 1 adds zero-knowledge cloud sync.
- **No accounts, no multi-device.** The unlock is a passphrase against a blob in *this* localStorage. Two devices = two unrelated vaults.
- **`Signal`, `DraftRow`, and `ReleaseCircle` components are dead code** after the redesign — left in place to avoid risk of stray references, will be cleaned up in a follow-up pass.

## Working conventions

- When modifying `main.jsx`, treat function ordering as significant: components are referenced top-down. Define helpers above the components that use them.
- Persistence: every vault mutation must call `onSave(nextVault, changeReason)` which routes through `persistVault`. The `changeReason` (e.g. `"record_change"`, `"attachment_change"`, `"balance_sheet_updated"`) is used by backup-health heuristics — pass it accurately.
- Audit log: long-lived events should be appended via the audit array (`appendAuditEvent` helper) so the in-product audit trail and recovery flows can show them.
- Tests use `node --test` — `assert` from `node:assert/strict`. Keep them pure-function only; no DOM, no React.
- Currency: `formatINR` / `formatINRCompact` in `main.jsx` are the only formatters that should output money. They route through `apps/web/src/lib/currency.js` which supports INR / USD / EUR / GBP with locale-aware compact units (lakh / crore for INR; k / M / B for Western). Vault has an optional `balanceSheet.currency` field; default is INR. Never hardcode `₹` in JSX.

## Reference

- [ROADMAP.md](ROADMAP.md) — 6-month production plan. Read before proposing new features.
- [docs/os-one-prd.md](docs/os-one-prd.md) — product vision and user model.
- [docs/os-one-technical-spec.md](docs/os-one-technical-spec.md) — original architecture spec (some of this is aspirational; ROADMAP.md is the current ground truth).
- [docs/kynlume-product-security-architecture.md](docs/kynlume-product-security-architecture.md) — security model document.
