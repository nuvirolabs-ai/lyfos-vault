# Digital Legacy Architecture

## Phase 2 boundary

Phase 2 adds a shared Digital Legacy domain package and bundled generic assets. It does not add UI routes, credential entry, database tables, nominee release material, or production feature enablement.

The authoritative implementation is `packages/digital-legacy`. Both web and mobile can consume the same catalogue and pure functions in later phases.

## Data boundary

User-specific Digital Legacy data belongs at `vault.digitalLegacy` inside the existing Stage 1 plaintext object before that object is encrypted with the existing AES-GCM vault key.

```text
Owner input
  -> Digital Legacy model and validation
  -> vault.digitalLegacy
  -> existing Stage 1 JSON encryption
  -> local encrypted record
  -> optional Supabase encrypted-blob sync
```

The server may see the same operational metadata it already sees for `vault_blobs`: owner row, encrypted-record size/version, and timestamps. It must not receive service usage, account labels, category reviews, record status, tags, custom services, field values, instructions, or scores in plaintext.

## Shared package boundaries

- `categories.js`: immutable category configuration.
- `services.js`: immutable service seed catalogue and aliases.
- `fieldTemplates.js`: built-in field definitions and storage policy.
- `catalogue.js`: lookup, filtering, alias search, and referential validation.
- `recordModel.js`: versioned aggregate and record creation/validation.
- `custom.js`: validated custom category, service, and field contracts.
- `permissions.js`: nominee release intent normalization. Phase 2 always returns `intent_only`.
- `status.js`: derived record status.
- `review.js`: review scheduling and freshness state.
- `score.js`: deterministic coverage, readiness, freshness, overall score, and priority actions.
- `search.js`: metadata-only owner search.
- `migrationAdapter.js`: non-destructive legacy index creation.
- `brandAssets.js`: local generic icon resolution and validation.

All modules are dependency-free ES modules and expose pure functions except secure identifier generation, which uses `crypto.randomUUID()` and fails closed if unavailable.

## Catalogue and user data

The built-in catalogue is non-sensitive product configuration. It is bundled with the application and versioned as `2026.08.1`.

User-created categories, services, field definitions, records, reviews, labels, and tags are sensitive user data. They remain inside `vault.digitalLegacy` and must never be merged into the bundled catalogue or sent to analytics.

## Release boundary

The current Circle of Trust recovers the root key for the full vault. Therefore Phase 2 stores only release intent:

```json
{
  "audience": "instructions_only",
  "recipientMode": "primary",
  "nomineeHolderIds": [],
  "trigger": "existing_circle",
  "enforcement": "intent_only"
}
```

No Phase 2 function may emit `cryptographically_enforced`. Record/field nominee permissions remain disabled until a separately reviewed per-record-key and release-manifest protocol exists.

## Feature flags

Every flag defaults to false:

- `VITE_FEATURE_DIGITAL_LEGACY_DASHBOARD`
- `VITE_FEATURE_DIGITAL_LEGACY_CATALOGUE`
- `VITE_FEATURE_DIGITAL_LEGACY_CREDENTIALS`
- `VITE_FEATURE_DIGITAL_LEGACY_OFFICIAL_ICONS`
- `VITE_FEATURE_DIGITAL_LEGACY_SCORE`
- `VITE_FEATURE_DIGITAL_LEGACY_REVIEW_REMINDERS`
- `VITE_FEATURE_DIGITAL_LEGACY_NOMINEE_FIELDS`
- `VITE_FEATURE_DIGITAL_LEGACY_CUSTOM_ICONS`

Only the exact strings `true` and `1` enable a flag. Enabling the dashboard or catalogue does not enable credential fields or nominee field permissions.

## Database decision

Phase 2 adds no Supabase migration. A normalized server catalogue would be unnecessary for the thesis prototype, and normalized user metadata would reduce privacy. Local seed configuration and encrypted user state meet the current requirements with less attack surface.

A future database migration is justified only for reviewed operational metadata or a cryptographically bound record-release manifest. Applied migrations must never be edited.

## Rollback

Phase 2 is additive and all runtime flags are off. Rollback consists of disabling flags and ignoring `vault.digitalLegacy`. The old `vault.items` collection remains intact. The migration adapter never deletes or rewrites old items and returns an existing Digital Legacy aggregate unchanged.
