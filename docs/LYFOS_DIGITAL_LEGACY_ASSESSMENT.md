# Lyfos Digital Legacy — Phase 1 Repository Assessment

**Assessment date:** 2 August 2026
**Scope:** Repository assessment only. No UI, database, encryption, release, or production behaviour was changed.

## Executive decision

Lyfos has a credible encrypted-vault foundation and a reusable Circle of Trust. It is safe to proceed next with a **catalogue/data-model slice** and then a **read-only visual prototype using sample data**.

It is **not yet safe to enable new credential entry or promise record-level nominee permissions**.

The reason is architectural, not cosmetic: the current owner vault is one AES-GCM-encrypted payload protected by one vault key. When a Circle recovery succeeds, the recipient receives that encrypted payload and reconstructs the key that decrypts the whole vault. The current `emergencyEligible` flag changes UI copy but does not cryptographically exclude private records from recovery. Therefore, permissions such as “existence only,” “instructions only,” “selected nominee,” or “credentials hidden” cannot be enforced by the existing release protocol.

The recommended path is:

1. Preserve the current encrypted Stage 1 vault and Circle of Trust.
2. Introduce a versioned Digital Legacy model and local service catalogue behind feature flags.
3. Build the icon-first experience with safe sample data before connecting writes.
4. Harden reveal, export, analytics, attachment, mobile-crypto, and cache behaviour.
5. Design and independently review a record-key/release-manifest extension before enabling credential storage or fine-grained nominee release.

## 1. What was inspected

The assessment covered:

- Workspace structure, package scripts, lockfile, and deployment configuration.
- Web application entry point, route selection, screen state, responsive styles, themes, service worker, and public nominee screens.
- Mobile Expo application, vault context, crypto implementation, storage, locking, and record screens.
- Shared vault and crypto packages.
- Supabase schema, all 22 migrations, Row Level Security policies, release procedures, email delivery tracking, and storage rules.
- Supabase authentication client, redirect construction, auth-email hook, nominee invitation function, and delivery webhooks.
- Stage 1 vault creation, key derivation, key wrapping, encryption, local storage, cloud sync, backup/restore, attachments, audit events, and inactivity locking.
- Circle invitation, role selection, recipient key derivation, share generation, owner activation, recovery request, admin review, supporting nominees, holding period, owner cancellation, and final recipient recovery.
- Analytics and monitoring stubs, Google Analytics bootstrap, search, OCR review, clipboard, export, sensitive reveal, and delete behaviour.
- Existing automated tests and build/check scripts.

Primary evidence locations include:

- `apps/web/src/main.jsx`
- `apps/web/src/lib/stage1Crypto.js`
- `apps/web/src/lib/stage1Store.js`
- `apps/web/src/lib/vaultSync.js`
- `apps/web/src/lib/stage1Session.js`
- `apps/web/src/lib/shareCrypto.js`
- `apps/web/src/lib/recoveryCeremony.js`
- `apps/web/src/lib/releasePlan.js`
- `apps/web/src/InviteAcceptScreen.jsx`
- `apps/web/src/NomineeEntryScreen.jsx`
- `apps/web/src/NomineeDownloadScreen.jsx`
- `apps/mobile/src/lib/crypto.ts`
- `apps/mobile/src/lib/vaultRecord.ts`
- `apps/mobile/src/lib/storage.ts`
- `apps/mobile/src/context/AppContext.tsx`
- `packages/vault-model/src/index.js`
- `supabase/migrations/0001_initial_schema.sql`
- `supabase/migrations/0002_rls_policies.sql`
- `supabase/migrations/0022_recipient_gated_circle.sql`
- `supabase/functions/send-auth-email/index.ts`
- `supabase/functions/send-key-holder-invite/index.ts`
- `apps/web/index.html`
- `apps/web/public/sw.js`
- `vercel.json`

This is a source-repository assessment. Host-level controls, live Supabase dashboard settings, deployed response headers, secrets, DNS, email-provider health, and production rate limits were not assumed merely because application code exists.

## 2. Current system summary

### Framework and application structure

- The repository is an npm-workspaces monorepo.
- The web app uses React 19 and Vite 7. Tailwind is present, with reusable CSS variables for light and dark themes in `apps/web/src/styles.css`.
- The main web experience is concentrated in `apps/web/src/main.jsx`, currently over 6,000 lines. Public invite, holder, nominee-entry, and nominee-download screens are separate modules.
- There is no React Router dependency. Public routes are selected from `window.location.pathname`; authenticated navigation mostly uses a local `screen` state.
- The mobile app uses Expo, React Native, and Expo Router.
- Supabase provides authentication, Postgres, Row Level Security, object storage, Edge Functions, and scheduled/backend workflows.
- `apps/backend/src/server.js` is a bare Node HTTP scaffold and is not identified by repository deployment configuration as the production API. It should not become the Digital Legacy API without separate hardening.
- Vercel builds the web workspace and rewrites unknown paths to the SPA. No security response-header policy is declared in `vercel.json`; live edge configuration still needs verification.

### Current vault model and experience

The owner vault plaintext is an in-memory object broadly shaped as:

```ts
type CurrentVault = {
  version: 1;
  items: CurrentVaultItem[];
  releaseSettings: {
    mainNominee: string;
    keyHolders: string[];
    emergencyOnly: boolean;
  };
  balanceSheet: unknown;
  audit: unknown[];
};
```

The web interface presents six hard-coded areas: Identity, Money, Access, Insurance, Documents, and Emergency. Records use a flat, generic item model with fields such as `type`, `title`, `username`, `secret`, `bankDetails`, `cardDetails`, `email`, `notes`, `financial`, `emergencyEligible`, and embedded attachments.

This model works for a general vault but is too ambiguous for the requested service templates, field classifications, review rules, explicit legacy actions, and record-level release projections.

Current category completion is derived from whether records exist, whether all records are `emergencyEligible`, and whether records are older than 90 days (`apps/web/src/main.jsx:448-480`). It must not be reused as the Digital Legacy Score because it conflates coverage, readiness, freshness, and release readiness.

Saving or editing an item updates the in-memory vault and re-encrypts the entire payload. Cloud sync is a single encrypted JSON record per user and uses last-write-wins comparison based on client timestamps. There is no field-level or record-level server API because the server cannot inspect the encrypted contents.

### File storage

Attachments are converted to data URLs and stored inside each encrypted vault item. The web client limits each attachment to 2 MiB, while `vault_blobs` has a total 5 MiB size constraint (`supabase/migrations/0001_initial_schema.sql:25-40`).

This is simple and keeps attachment content inside the ciphertext, but it will not scale to a complete digital legacy containing identity, insurance, property, health, or memory documents. Validation currently accepts a file when either its claimed MIME type or filename extension is allowed; it does not inspect file signatures or sanitize active document content.

### State management and testing

- React state and focused context modules are used; there is no global state library.
- The web package has useful Node unit tests for crypto, storage, restore, attachments, release, Circle recovery, URLs, and supporting models.
- There is no repository-visible component-test or end-to-end browser suite.
- Mobile has one routing test; its `check` command only reports a scaffold message and does not type-check or build the app.
- No repository-visible CI workflow runs builds, tests, security tests, or dependency checks.

## 3. How encryption currently works

### Web vault encryption

1. A new vault gets a random 256-bit AES-GCM vault key generated with Web Crypto (`apps/web/src/lib/stage1Crypto.js:253-258`).
2. The whole JSON vault is encrypted with AES-GCM and a fresh 12-byte IV (`apps/web/src/lib/stage1Crypto.js:342-351`).
3. The vault key is exported and separately wrapped for the user's vault passphrase and optional recovery phrase (`apps/web/src/lib/stage1Crypto.js:261-300`).
4. New wrapping keys use Argon2id. The web defaults are 64 MiB memory, three iterations, parallelism one, and a 32-byte output. Legacy PBKDF2-SHA256 envelopes at 600,000 iterations remain readable and are upgraded after a successful unlock.
5. New recovery material is a 24-word BIP39 phrase. A vault passphrase must be at least 12 characters.
6. The versioned outer record contains public algorithm/KDF metadata, key envelopes, and one `encryptedVault` value (`apps/web/src/lib/stage1Crypto.js:81-117`). Authentication login is explicitly separate from vault decryption.

The encrypted record is stored locally under a versioned `localStorage` key. When the user is authenticated, the same ciphertext record can be synced to `public.vault_blobs`. The database can see only operational metadata such as user ID, record version, byte size, and timestamps—not the decrypted vault contents.

RLS limits `vault_blobs` access to the owning authenticated user. This is defence in depth; client-side encryption remains necessary because the application server/storage layer should not receive plaintext vault data.

### Locking

The web app has:

- Manual lock.
- A configurable inactivity timeout, defaulting to five minutes.
- Lock on document visibility/background transition.
- Clearing of decrypted vault/key references from application state when locked.

The mobile context also locks on inactivity and backgrounding and overwrites its raw key byte array before releasing it. Web `CryptoKey` objects cannot be reliably zeroed by JavaScript, so the practical control is to release references and minimize plaintext lifetime.

### Mobile encryption and storage

Mobile implements a wire-compatible versioned vault record using AES-GCM envelopes. Encrypted records are chunked and stored in Expo SecureStore; non-secret application state uses AsyncStorage.

Two mobile implementation details block a high-assurance credential launch:

- Newly created mobile vaults use Argon2id at 8 MiB and two iterations (`apps/mobile/src/lib/crypto.ts:34-44`), while comments acknowledge a native Argon2 implementation is needed before restoring stronger parameters.
- Cryptographic `randomBytes` falls back to `Math.random()` if the secure random polyfill is unavailable (`apps/mobile/src/lib/crypto.ts:127-136`). Cryptographic operations must fail closed instead.

### What encryption does and does not guarantee

Verified strengths:

- Authenticated encryption is used.
- A random vault key is separated from passphrase-derived wrapping keys.
- KDF and record formats are versioned.
- The server does not need plaintext to store and sync the vault.
- Authentication credentials and vault passphrases are separate.
- Background and inactivity locking exist.

Limits:

- All fields share one vault key and one ciphertext payload. Field classifications would initially be UI policy, not separate cryptographic boundaries.
- Any script executing on the unlocked app origin can potentially access in-memory plaintext or trigger application actions.
- Last-write-wins whole-blob sync can overwrite concurrent edits.
- A successful Circle release recovers the key for the full payload.

## 4. How nominees and release currently work

### Invitation and role selection

The owner selects a nominee role directly in the invitation UI: Primary, Backup, or Trusted (`apps/web/src/main.jsx:6031-6071`). Database indexes enforce at most one non-revoked primary and one non-revoked backup (`supabase/migrations/0022_recipient_gated_circle.sql:44-50`).

The invite flow:

- Creates a cryptographically random invite token.
- Stores only its SHA-256 hash in the database.
- Applies a 30-day expiry and resend throttling/rotation.
- Sends a canonical public HTTPS link through the configured Edge Function/email provider.
- Requires the accepting authenticated account email to match the invited email.
- Records email delivery state in a delivery ledger.

Repository code is designed to avoid localhost in production links, but actual email arrival still depends on deployed Supabase Auth hooks, function secrets, provider configuration, sender-domain health, and production redirect allowlists. Those are runtime checks, not guarantees derived from source code.

### Circle activation

Activation requires exactly five accepted and verified holders with recovery public keys. Primary and Backup are chosen by the owner; the remaining holders are supporting nominees.

Each nominee creates a separate recovery passphrase. The client derives a stable Curve25519 keypair from that passphrase and the nominee user ID. Only the public key is uploaded; the private key is discarded and later re-derived.

The owner client then:

1. Creates a random recipient gate.
2. Masks the raw vault key with that gate.
3. Splits the masked key using a 2-of-5 secret-sharing scheme.
4. Encrypts one supporting share to each holder's public key.
5. Encrypts the gate separately to the Primary and Backup.
6. Encrypts owner instructions to the Primary and Backup.
7. Records a versioned Circle generation and share commitments.

This means a Primary or approved Backup cannot recover alone: the recipient gate plus two other nominees' supporting shares are required.

### Release

- The Primary may start a normal recovery.
- The Backup may start a fallback recovery and must provide a reason.
- The requester must provide an evidence summary and evidence document.
- An administrator must approve the request before support is collected.
- Supporting nominees must be verified, cannot be the recipient, and release their matching generation share.
- Two supporting shares move the request into the holding period.
- The server enforces the configured hold before moving to `ready_to_recover`.
- The owner can abort through the pre-recovery states.
- At recovery, the server returns the recipient gate envelope, only the released supporting shares, and the encrypted vault record to the authenticated requester (`supabase/migrations/0022_recipient_gated_circle.sql:838-902`).
- The client reconstructs the raw vault key and decrypts the recovered vault.

The nominee UI is read-only and already contains a clear, ordered recovery guide. That instruction pattern should be reused for future record-level release guidance.

### Critical release limitation

The recovered view removes selected owner settings but returns all vault items with reveal, copy, and attachment-download capabilities (`apps/web/src/lib/recoveryCeremony.js:100-128`). The database snapshots the full encrypted record the first time ready recovery material is fetched, not at request creation or approval.

Consequences:

- `emergencyEligible: false` does not exclude an item from successful recovery.
- The owner UI copy “Private to you / Not included in your release plan” is not enforced by the recovered payload (`apps/web/src/main.jsx:4573-4581`).
- Current recovery cannot distinguish account existence, non-sensitive metadata, instructions, documents, or credentials.
- Fine-grained nominee choices from the requested design would be misleading until the release cryptography changes.
- Owner edits made between the recovery request and the first successful material fetch may be included in that recovery snapshot. The desired snapshot moment needs an explicit product/security decision.

## 5. Existing components and patterns that can be reused

| Existing capability | Reuse recommendation |
| --- | --- |
| Stage 1 AES-GCM vault, envelopes, KDF versioning | Keep as the owner-vault root; extend through versioned plaintext data, not a second improvised crypto format. |
| Local encrypted store and Supabase ciphertext sync | Reuse for the first model/prototype slices; add conflict strategy before large-scale editing. |
| Manual/background/inactivity lock | Reuse and add recent-auth gates for critical actions. |
| Backup, recovery phrase, import/restore validation | Reuse after testing the new schema-version adapter. |
| Circle invitation, roles, five-holder activation | Reuse unchanged; do not create a parallel nominee system. |
| Recipient-gated release, admin review, two supporters, hold, owner abort | Reuse as the release trigger and governance layer; extend the released cryptographic material later. |
| Nominee recovery guide | Reuse its progressive instruction style for record release. |
| Auth URL canonicalization and email-delivery ledger | Reuse for invitations/reminders; retain runtime health checks. |
| RLS ownership patterns and security-definer procedures | Reuse for any new server-visible operational metadata, after privilege review. |
| Theme variables, typography, responsive cards, drawers, empty states | Reuse for a calm icon-first experience. |
| Existing record/category UI patterns | Reuse visual interaction patterns, but not the current flat record schema or completion algorithm. |
| Attachment UI and encrypted embedding | Reuse only for the prototype/small proofs; harden validation and redesign storage before document-heavy use. |
| In-vault audit sanitizer and server audit table | Reuse as inputs, but do not describe them as tamper-evident without an integrity design. |
| Expo Router and mobile UI primitives | Reuse after moving shared catalogue/model logic out of platform-specific code. |

The current `main.jsx` should not absorb another large feature. New Digital Legacy code should be modular and integrated through a small screen boundary.

## 6. Security gaps that must be resolved

Severity definitions: **P0** blocks credential storage or truthful permission claims; **P1** is required before production rollout; **P2** is hardening/quality work that should be scheduled.

| ID | Severity | Repository evidence | Impact | Required mitigation |
| --- | --- | --- | --- | --- |
| DL-01 | P0 | Recovery returns the complete encrypted vault and a key capable of decrypting it. Recovered capabilities reveal/copy every item. | Record/field nominee privacy cannot be enforced. Current private-item copy is misleading. | Introduce per-record data keys and a cryptographically bound release manifest/projection, or limit product claims to whole-vault release. |
| DL-02 | P0 | Owner record detail renders bank and card details unmasked; only `secret` is masked (`main.jsx:4515-4565`). Reveal is a local toggle. | Shoulder-surfing and unauthorized disclosure from an unlocked session. | Classify every field, mask high-risk values, require recent vault reauthentication, auto-hide, and clear transient state. |
| DL-03 | P0 | Export, critical delete, and release-rule changes do not consistently require recent reauthentication. | An unattended unlocked session can disclose or destructively change high-value data. | Add a single recent-auth policy service and gate reveal, copy, export, critical delete, and release-policy changes. |
| DL-04 | P0 | Google Tag Manager/Analytics JavaScript loads on the vault origin; optional Plausible injection accepts arbitrary event props; auth bearer session is persisted in `localStorage`. No CSP/header policy is declared in the repository. | Same-origin third-party/XSS compromise has high impact while the vault is unlocked. Path scrubbing is not an analytics property firewall. | Remove third-party scripts from the sensitive app shell or isolate marketing and vault origins; add an allowlisted analytics wrapper; deploy and verify CSP and other headers; prohibit replay. |
| DL-05 | P0 | Mobile crypto can fall back to `Math.random()` and new mobile vaults use intentionally reduced Argon2 parameters. | Weak entropy would invalidate key security; low KDF cost weakens offline passphrase resistance. | Fail closed without a CSPRNG; use reviewed native Argon2id; define and test a cross-platform parameter policy. |
| DL-06 | P0 | No field-classification/prohibited-data policy exists. Generic forms invite “Password, PIN, locker code”; OCR can display a detected secret directly. | Users may store OTPs, CVVs, temporary codes, seed phrases, or provider-prohibited data without appropriate controls. | Add field classifications, prohibited types, critical-field kill switch, contextual warnings, and no-OCR/no-autofill rules where required. |
| DL-07 | P0 | Current whole-vault encryption has no record-level release key boundary. | `existence_only`, `instructions_only`, selected nominee, and credentials-hidden modes would be UI-only. | Complete a threat model and independently review the record-key/release-manifest protocol before Phase 5 credentials/permissions. |
| DL-08 | P1 | Owner search indexes username, email, notes, bank details, and card details in decrypted memory. Attention logic also scans free text. | Sensitive content is broader in memory and could leak through future telemetry/debug features. | Search only service name, account label, category, tags, and status; explicitly exclude classified values. |
| DL-09 | P1 | Clipboard writes have no timed clear on web nominee recovery or mobile owner screens. | Copied secrets may remain available to other applications/users. | Clear after a short configurable interval where supported; warn when the platform cannot guarantee clearing. |
| DL-10 | P1 | The nominee can download a plaintext copy of the entire recovered vault after a browser confirmation. | Creates a durable, unencrypted high-value file outside Lyfos controls. | Prefer encrypted export; require recent recovery auth and explicit risk acknowledgement; consider disabling plaintext export by default. |
| DL-11 | P1 | Attachment acceptance trusts claimed MIME or extension and previews content. Data URLs increase whole-blob size. | Content spoofing, unsafe preview, resource exhaustion, and storage failure. | Inspect magic bytes, restrict formats, sandbox previews, strip active content/metadata where appropriate, and design encrypted object storage. |
| DL-12 | P1 | Service worker caches first-party HTML navigations and static GET responses without an explicit sensitive-route/API exclusion. | Future same-origin recovery/data endpoints could be cached accidentally. | Add explicit allowlist caching, never cache API/recovery responses, and set `Cache-Control: no-store` on sensitive material. |
| DL-13 | P1 | Local in-vault audit is mutable with the payload; server audit is append-oriented but client-submitted metadata is not cryptographically chained. | Activity history is not tamper-evident enough for strong security claims. | Define authoritative events, append permissions, integrity chaining/signing, retention, and redaction. |
| DL-14 | P1 | Whole-blob sync is last-write-wins using client wall clocks. | Concurrent web/mobile edits can silently lose records or release-policy changes. | Add revision/ETag conflict detection and explicit merge/retry behaviour before broad rollout. |
| DL-15 | P1 | Signing out of the Supabase account is separate from locking the already decrypted local vault. Device revocation appears registry-based and needs session-invalidation verification. | Users may assume account sign-out closes local plaintext access. | Make sign-out lock first; define and test remote session/device revocation semantics. |
| DL-16 | P1 | Recovery snapshot is captured on first ready-material fetch rather than request/approval/hold transition. | The released content set may change during an active claim. | Bind a versioned release manifest and encrypted snapshot at the selected governance event. |
| DL-17 | P1 | Email delivery is provider/dashboard dependent despite robust repository functions and ledgers. | Invite/activation reliability cannot be proven solely from code. | Add deployment health checks, provider webhook monitoring, resend UI, domain/auth checks, and end-to-end production canary tests. |
| DL-18 | P2 | No component/E2E/security suite; mobile check is a scaffold; no CI workflow is visible. | Regressions in masking, routes, mobile crypto, and release permissions may ship undetected. | Add unit, integration, Playwright, mobile type/build, and security regression gates in CI. |
| DL-19 | P2 | Vercel uses `npm install` despite a lockfile. | Build dependency resolution is less reproducible than necessary. | Use a lockfile-enforced install and dependency scanning. |

No `dangerouslySetInnerHTML`, `eval`, `new Function`, or application `postMessage` use was found in the inspected web source. This is a positive finding, not proof that the full deployed application is XSS-free.

## 7. Recommended architecture and data model

### Architecture options

#### Option A — versioned Digital Legacy aggregate inside the existing vault (recommended now)

Store catalogue references, non-sensitive metadata, field values, review state, and release intent inside the existing encrypted vault plaintext, then continue encrypting the whole payload with the current Stage 1 vault key.

Advantages:

- Smallest safe change.
- Preserves zero-knowledge-style server storage.
- Reuses backup, restore, sync, locking, and mobile wire compatibility.
- Suitable for the catalogue, score, review, read-only prototype, and owner-only metadata.

Limit:

- Per-field classification controls owner UI behaviour but does not create field-level cryptographic isolation.
- Cannot enforce fine-grained nominee release.

#### Option B — per-record keys plus a release manifest (required for fine-grained nominee release)

Generate a random data-encryption key (DEK) per legacy record. Wrap each DEK for the owner vault, and release only the DEKs/projections authorized by an immutable, versioned release manifest. Bind record IDs, allowed field classes, recipient(s), Circle generation, policy version, and content/snapshot version using authenticated data or a signed/MACed manifest.

Advantages:

- Can enforce private, existence-only, instructions-only, documents-only, and full-record release modes.
- Supports selected nominees without handing every recipient the owner root vault key.

Costs/risks:

- Material cryptographic-protocol and migration work.
- Revocation, edits during claims, key rotation, backup/restore, multi-device sync, and offline recovery become more complex.
- Requires a repository-grounded threat model, test vectors, migration rehearsal, and independent security review.

#### Option C — normalized plaintext metadata and encrypted payloads on the server (not recommended for this prototype)

This would simplify server APIs and search, but reveal account existence, category, labels, status, and review patterns to the backend. It substantially expands RLS/API scope and conflicts with the existing private encrypted-blob architecture.

### Recommended owner-vault model for Phases 2–4

```ts
type DigitalLegacy = {
  schemaVersion: 1;
  categoryReviews: CategoryReview[];
  customCategories: CustomLegacyCategory[];
  customServices: CustomLegacyService[];
  records: LegacyRecord[];
};

type LegacyRecord = {
  id: string;
  categoryId: string;
  serviceTemplateId?: string;
  customServiceId?: string;
  accountLabel?: string;
  status:
    | "started"
    | "protected"
    | "incomplete"
    | "needs_review"
    | "action_required"
    | "scheduled_for_release"
    | "released"
    | "archived";
  tags: string[];
  fields: LegacyFieldValue[];
  instructions: {
    action:
      | "transfer"
      | "memorialise"
      | "close"
      | "delete"
      | "archive"
      | "contact_provider"
      | "release_information"
      | "custom";
    customText?: string;
  };
  releasePolicy: {
    audience:
      | "owner_only"
      | "existence_only"
      | "instructions_only"
      | "full_record";
    recipientMode:
      | "primary"
      | "backup_fallback"
      | "all_authorized"
      | "selected";
    nomineeHolderIds: string[];
    trigger: "existing_circle" | "manual";
    enforcement: "intent_only" | "cryptographically_enforced";
  };
  review: {
    frequency: "3_months" | "6_months" | "yearly" | "custom" | "none";
    customDays?: number;
    lastReviewedAt?: string;
    nextReviewAt?: string;
  };
  attachments: CurrentEncryptedAttachment[];
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

type LegacyFieldValue = {
  fieldKey: string;
  classification:
    | "identity_information"
    | "account_information"
    | "authentication_secret"
    | "financial_secret"
    | "recovery_secret"
    | "private_cryptographic_key"
    | "personal_instruction"
    | "supporting_document";
  value: unknown;
  revealPolicy: "normal" | "recent_auth" | "disabled";
  copyPolicy: "allowed" | "confirm" | "disabled";
};

type CategoryReview = {
  categoryId: string;
  state: "reviewed" | "not_applicable";
  reviewedAt: string;
};
```

Notes:

- Do not duplicate `encryptedPayload`, nonce, authentication tag, or wrapped-key columns inside this model while Option A is used; the whole object is already inside the authenticated Stage 1 ciphertext.
- Do not add `ownerUserId` inside the encrypted record unless a verified use case requires it. The outer database row already owns the ciphertext.
- `readinessScore`, `coverageScore`, and `freshnessScore` should be deterministic derived values, not trusted mutable fields. Persist inputs and scoring-spec version; calculate results after unlock.
- `releasePolicy.enforcement` must remain `intent_only` until Option B is live. Credential-field and nominee-permission feature flags must prevent misleading UI.
- Store the service catalogue as non-user-specific versioned configuration. Keep user account labels, usage, review state, tags, and custom service content inside encrypted vault data.

### Scoring recommendation

Implement the requested transparent formula:

- Coverage: 40% — categories explicitly reviewed or marked not applicable.
- Readiness: 40% — record identity, recovery path, action, nominee intent, supporting information, and release condition. A password is never required.
- Freshness: 20% — calculated from configurable review intervals.

Keep these three values visible. Use “prepared,” never “secure,” “guaranteed,” or “100% protected.”

### Catalogue recommendation

Create a shared, versioned package for categories, services, aliases, fields, actions, scoring, and safe search. Web and mobile currently duplicate classification concepts; a shared package prevents drift.

Use local generic icons first. Brand assets should have explicit metadata and `approved`, `pending-review`, or `generic-only` status. Do not hotlink or scrape service artwork.

## 8. Recommended page and component structure

The first UI integration should preserve existing route behaviour and add “My Legacy” behind a feature flag. Avoid a routing rewrite as a prerequisite.

```text
packages/digital-legacy/
  package.json
  src/
    categories.js
    services.js
    fieldTemplates.js
    brandAssets.js
    recordModel.js
    status.js
    score.js
    review.js
    permissions.js
    search.js
    migrationAdapter.js
    index.js
    *.test.js

apps/web/src/legacy/
  featureFlags.js
  MyLegacyScreen.jsx
  LegacyCategoryScreen.jsx
  LegacyRecordScreen.jsx
  components/
    LegacyHeader.jsx
    LegacyScore.jsx
    CategoryCard.jsx
    ServiceCard.jsx
    ServiceIcon.jsx
    PriorityActions.jsx
    RecentlyUpdated.jsx
    LegacySearch.jsx
    LegacyFilters.jsx
    AddRecordFlow.jsx
    SensitiveField.jsx
    LegacyRecordDetail.jsx
    NomineeAccessSummary.jsx
    ReviewFlow.jsx
    RecoveryInstructionGuide.jsx
    LegacyEmptyState.jsx

apps/web/public/assets/legacy-services/
  generic/
  banking/
  investments/
  social/
  communication/
  devices/
  cloud/
  government/
  insurance/
  business/
  subscriptions/
  health/
  memories/
  metadata.json
```

Component boundaries:

- `MyLegacyScreen` composes score, categories, at most three priority actions, and recently updated metadata.
- `LegacyCategoryScreen` owns search/filter/sort and multiple-account service cards.
- `AddRecordFlow` is progressive and template-driven; it must not render sensitive fields until Phase 4 gates pass.
- `SensitiveField` is the only component allowed to reveal/copy classified values and must call a centralized recent-auth policy.
- `NomineeAccessSummary` explains release intent and enforcement honestly. Before Option B it must not claim that private records are excluded from whole-vault recovery.
- `RecoveryInstructionGuide` adapts the existing nominee guide into step-by-step, non-technical instructions.
- Mobile should consume the same shared package and implement native screen components rather than duplicating catalogue/scoring logic.

## 9. Exact files likely to be added or modified

Only this assessment file was created in Phase 1. The following is the expected later change surface, not an instruction to edit all files at once.

### Expected additions

- `packages/digital-legacy/package.json`
- `packages/digital-legacy/src/index.js`
- `packages/digital-legacy/src/categories.js`
- `packages/digital-legacy/src/services.js`
- `packages/digital-legacy/src/fieldTemplates.js`
- `packages/digital-legacy/src/brandAssets.js`
- `packages/digital-legacy/src/recordModel.js`
- `packages/digital-legacy/src/status.js`
- `packages/digital-legacy/src/score.js`
- `packages/digital-legacy/src/review.js`
- `packages/digital-legacy/src/permissions.js`
- `packages/digital-legacy/src/search.js`
- `packages/digital-legacy/src/migrationAdapter.js`
- `packages/digital-legacy/src/*.test.js`
- `apps/web/src/legacy/featureFlags.js`
- `apps/web/src/legacy/MyLegacyScreen.jsx`
- `apps/web/src/legacy/LegacyCategoryScreen.jsx`
- `apps/web/src/legacy/LegacyRecordScreen.jsx`
- `apps/web/src/legacy/components/*.jsx`
- `apps/web/src/legacy/*.test.js`
- `apps/web/public/assets/legacy-services/metadata.json`
- `apps/web/public/assets/legacy-services/generic/*`
- `apps/web/e2e/digital-legacy.spec.js`
- `supabase/migrations/0023_digital_legacy_operational_metadata.sql` only if Option A requires server-visible operational state; otherwise no Phase 2 DB migration is necessary.
- `supabase/migrations/0024_record_release_manifests.sql` only after Option B review; numbering must be rebased against migrations added meanwhile.
- `docs/DIGITAL_LEGACY_ARCHITECTURE.md`
- `docs/DIGITAL_LEGACY_DATA_MODEL.md`
- `docs/VAULT_ENCRYPTION_MODEL.md`
- `docs/LEGACY_SCORE_SPECIFICATION.md`
- `docs/BRAND_ASSET_POLICY.md`
- `docs/NOMINEE_PERMISSION_MODEL.md`
- `docs/LEGACY_RECORD_MIGRATION.md`
- `docs/DIGITAL_LEGACY_THREAT_MODEL.md`
- `docs/DIGITAL_LEGACY_TEST_PLAN.md`

### Expected modifications

- Root `package.json` and lockfile — add the shared package and test/build tooling.
- `apps/web/package.json` — component/E2E test scripts and only necessary dependencies.
- `apps/web/src/main.jsx` — a small feature-flagged navigation/screen integration; progressively remove Digital Legacy logic into modules.
- `apps/web/src/styles.css` — reusable Legacy tokens/components, focus states, and reduced-motion treatment.
- `apps/web/index.html` — remove sensitive-origin third-party analytics bootstrap and support a strict CSP strategy.
- `apps/web/vite.config.js` — build/test configuration if required.
- `apps/web/public/sw.js` — explicit cache allowlist and sensitive-route exclusions.
- `apps/web/src/lib/telemetry.js` — deny-by-default event/property schema and redaction.
- `apps/web/src/lib/stage1Crypto.js` — schema compatibility and, only after review, record-key support.
- `apps/web/src/lib/stage1Store.js` — versioned migration/rollback markers.
- `apps/web/src/lib/vaultSync.js` — revision conflict detection.
- `apps/web/src/lib/stage1Session.js` — centralized recent-auth and sensitive auto-hide policy.
- `apps/web/src/lib/stage1Audit.js` — new event types and stronger integrity contract.
- `apps/web/src/lib/stage1Attachments.js` — signature validation and safer attachment metadata.
- `apps/web/src/lib/shareCrypto.js` — only for the independently reviewed per-record release protocol.
- `apps/web/src/lib/recoveryCeremony.js` — consume a projected release manifest instead of exposing the full vault.
- `apps/web/src/lib/releasePlan.js` and `apps/web/src/lib/releaseClaim.js` — manifest/snapshot binding after protocol review.
- `apps/web/src/NomineeEntryScreen.jsx` — explain record-level release safely.
- `apps/web/src/NomineeDownloadScreen.jsx` — render only authorized projections, harden copy/export, retain clear instructions.
- `apps/web/src/HolderReleaseScreen.jsx` — show non-sensitive request scope/manifest version without leaking records.
- `apps/web/src/InviteAcceptScreen.jsx` — only if recovery-key policy changes.
- `apps/mobile/src/context/AppContext.tsx` — schema adapter and recent-auth/lock integration.
- `apps/mobile/src/lib/crypto.ts` — fail-closed randomness and native Argon2 policy.
- `apps/mobile/src/lib/vaultRecord.ts` — schema and future record-key compatibility.
- `apps/mobile/src/lib/storage.ts` — migration/rollback and storage-capacity handling.
- `apps/mobile/app/area/[id].tsx` and future Legacy routes — classified masking/copy controls.
- `packages/vault-model/src/index.js` — compatibility adapter or deprecation in favor of `packages/digital-legacy`.
- `supabase/functions/send-key-holder-invite/index.ts` — only if invite payloads gain non-sensitive manifest context.
- `vercel.json` — locked install and repository-managed security/cache headers where supported.

### Files that should not be casually repurposed

- `apps/backend/src/server.js`: development scaffold, permissive CORS default, and raw error responses make it unsuitable as a new sensitive API without a dedicated redesign.
- Existing migrations: never edit applied migration files; add new reversible migrations.

## 10. Dependencies required

Phase 2 should prefer existing React/Vite/Node capabilities and add no runtime dependency unless it materially reduces risk. Likely later requirements are:

- A component/integration test stack compatible with React 19.
- Playwright for browser flows and cache/clipboard/reauth regression tests.
- A mobile native Argon2id implementation or audited platform binding.
- File-signature/content inspection appropriate to the allowed attachment set.
- Optional schema validation for versioned catalogue and vault data; choose one library and share it across web/mobile where practical.

Do not add an icon-scraping service, hosted search provider, session replay SDK, or a second crypto library merely for the redesign.

Non-code dependencies:

- Independent cryptographic/security review for Option B and credential-field enablement.
- Brand/legal approval workflow for official service icons.
- Product decision on prohibited secret types and critical-category kill switches.
- Runtime access to verify Supabase Auth, Resend/domain configuration, Vercel headers/cache behaviour, and production redirect allowlists.

## 11. Migration risks and strategy

### Main risks

1. **Ambiguous legacy classification.** Existing generic types do not map reliably to the 15 requested categories. Guessing can expose or misrepresent sensitive information.
2. **False release privacy.** Mapping `emergencyEligible: false` to “owner only” would create a promise the current Circle recovery does not enforce.
3. **Whole-blob rollback.** A bad client-side migration can make the only synced encrypted record unreadable across devices.
4. **Cross-platform drift.** Web and mobile use compatible envelopes but different KDF creation parameters and separate models.
5. **Sync conflicts.** A legacy client can overwrite a migrated payload because sync is whole-record last-write-wins.
6. **Attachment capacity.** Existing data-URL attachments may approach the 5 MiB vault cap before migration adds metadata.
7. **Score misrepresentation.** Old record presence is not evidence that a category was reviewed or a nominee could act.
8. **Active release requests.** Changing keys, record formats, Circle generations, or snapshots while a recovery is in progress can strand or alter a claim.
9. **Backup compatibility.** Imported/exported encrypted backups must remain readable across old/new versions and platforms.
10. **Custom free text.** Notes may contain credentials even when the field is not classified as secret.

### Safe migration approach

- Add a schema-versioned adapter with read-old/write-new support.
- Preserve original item IDs and content. Never destructively rewrite the only copy on first read.
- Deterministically map only unambiguous types.
- Put ambiguous items in **Imported legacy records** and ask the owner to review them.
- Treat `emergencyEligible` as historical release intent, not an enforceable permission.
- Calculate scores only after explicit category/record review; do not award coverage by guessing.
- Create an encrypted pre-migration backup and verify it can decrypt before committing the migrated record.
- Use compare-and-swap revision checks so an older client cannot silently overwrite a migrated payload.
- Feature-flag new reads and writes independently; support rollback to the old renderer without discarding newly written data.
- Block model/key migration while an active release claim exists unless the release protocol explicitly handles both versions.
- Rehearse fixtures for empty, small, attachment-heavy, PBKDF2-legacy, web-created, mobile-created, and active-Circle vaults.

## 12. Phased implementation plan

### Phase 1 — assessment (this document)

- Completed repository architecture, vault, crypto, Circle, storage, analytics, tests, and deployment inspection.
- No production behaviour changes.

### Phase 2A — security decisions and specifications

- Write the encryption model, threat model, nominee permission model, prohibited-data policy, analytics policy, and migration test plan.
- Decide release snapshot timing and Option B protocol boundaries.
- Define feature flags and recent-auth requirements.
- Exit criterion: credential fields remain disabled; reviewers agree on what the current system can honestly promise.

### Phase 2B — shared catalogue and owner data model

- Add versioned categories, generic service icons, aliases, field templates, record statuses, review model, deterministic score functions, safe search, and migration adapter.
- Unit-test all calculations and mappings.
- Do not add DB records if the catalogue and user state can remain inside the encrypted vault.
- Exit criterion: shared package passes tests on web/mobile fixtures and does not expose user metadata server-side.

### Phase 3 — read-only visual prototype

- Add feature-flagged My Legacy dashboard, category/service cards, metadata-only search/filter, record detail layout, responsive states, dark mode, accessibility, and calm nominee instructions.
- Use safe sample data only. No password fields and no production migration.
- Exit criterion: user-testing validates comprehension and visual hierarchy without security claims.

### Phase 4A — owner-only non-secret create/edit

- Connect template-driven forms for low-risk metadata, legacy actions, review state, and release intent.
- Add recent-auth service, safe analytics wrapper, conflict detection, migration backup, and audit events.
- Keep authentication/financial/recovery/private-key fields independently disabled.
- Exit criterion: cross-platform migration, lock, backup, restore, and rollback tests pass.

### Phase 4B — sensitive-field hardening

- Remove third-party code from the sensitive origin or isolate it.
- Deploy/verify CSP and cache headers.
- Fix mobile entropy/KDF, masking, auto-hide, clipboard, export, OCR, attachment validation, sign-out lock, and critical delete/release-rule reauthentication.
- Exit criterion: threat-model mitigations and security regression tests pass; independent review approves the enabled field classes.

### Phase 5 — record-level nominee and release integration

- Implement reviewed per-record DEKs and cryptographically bound release manifests/projections.
- Reuse Circle roles, admin review, two supporters, hold, owner abort, delivery, and recovery guide.
- Add revocation, generation rotation, snapshot timing, active-claim migration, and recovery test vectors.
- Exit criterion: unauthorized records/fields remain cryptographically unrecoverable in adversarial tests.

### Phase 6 — score and review workflow

- Enable coverage/readiness/freshness, no more than three priority actions, non-sensitive reminders, and review-without-reveal.
- Validate score copy and accessibility.

### Phase 7 — production hardening

- Complete permission, logging, analytics, cache, session, upload, dependency, and infrastructure audits.
- Add CI gates, E2E/security tests, monitoring, invite/recovery canaries, and incident/rollback procedures.

### Phase 8 — gradual production migration

- Release behind cohort flags.
- Start with read-only and non-secret categories.
- Monitor migration/sync/email/recovery health.
- Enable sensitive classes individually only after their security gates pass.
- Preserve old data and a tested rollback throughout rollout.

## 13. Blockers preventing safe credential storage

Credential storage must remain disabled until all of these are resolved:

1. A reviewed field-classification and prohibited-data policy exists. OTPs, current temporary codes, and full payment-card CVVs must never be stored.
2. Critical secrets have independent feature flags, with seed phrases/private keys/password-manager master passwords disabled by default until separately approved.
3. Recent vault reauthentication gates reveal, copy, export, critical delete, and release-policy changes.
4. Every classified value is masked by default, auto-hides, clears transient UI state, avoids URLs/logs/errors/analytics/accessibility labels, and has tested clipboard behaviour.
5. Third-party analytics code is removed from or isolated away from the unlocked vault origin; a deny-by-default event/property wrapper and verified CSP/header policy are deployed.
6. Mobile cryptographic randomness fails closed and a reviewed native Argon2id policy replaces the reduced pure-JavaScript creation path.
7. Attachment and OCR paths cannot expose or ingest critical secrets without the same classification and reauthentication controls.
8. Sensitive responses/exports are never cached; the service worker and deployed cache headers are verified.
9. Sign-out, inactivity, backgrounding, and device/session revocation semantics are consistent and tested.
10. Backup, restore, sync conflict, migration, and rollback tests cover both web and mobile vaults.
11. An independent security review approves the credential-storage threat model and implementation.

Fine-grained nominee release has additional blockers:

12. The release flow no longer gives recipients a root key that decrypts unauthorized records.
13. Per-record keys and release manifests cryptographically bind the allowed records, allowed field projections, recipient, Circle generation, policy version, and snapshot version.
14. Revocation, recipient replacement, edits during active claims, key rotation, refusal, owner abort, and fallback recovery have verified test vectors.
15. The UI and nominee instructions distinguish existence, metadata, documents, instructions, and credentials without claiming an unimplemented provider action or permission.

## 14. Runtime questions and verification blockers

These do not block Phase 2 catalogue work, but they block production security/reliability sign-off:

- What security headers are applied by the live Vercel/CDN configuration?
- Are Google Analytics or Plausible environment values active on `app.lyfos.in`, and can marketing analytics be separated onto a non-vault origin?
- Are Supabase production email confirmation, redirect allowlists, Auth hook secrets, resend limits, and custom SMTP/Resend settings exactly aligned with the repository functions?
- Are Resend domain authentication and delivery webhooks healthy, monitored, and alerting?
- What is the authoritative production release hold duration and admin-review operating procedure?
- Does device revocation invalidate/refresh live authentication sessions, or only mark a device record?
- When should a release snapshot freeze: request creation, admin approval, start of hold, ready state, or owner-selected policy version?
- Which credential classifications will Lyfos permit at launch, and which remain disabled pending independent review?
- Is plaintext nominee export a deliberate product requirement or a legacy convenience that can be removed?
- What is the approved retention/deletion policy for recovery evidence documents and email delivery metadata?

## Phase 1 conclusion

The correct next implementation slice is **the shared service catalogue, versioned owner data model, scoring specification, and feature-flagged read-only visual prototype**. It can be built without changing Circle behaviour or enabling credential storage.

Lyfos should not claim per-record nominee privacy—or accept new password/PIN/recovery-key classes—until the P0 controls and record-key release architecture are complete and reviewed.
