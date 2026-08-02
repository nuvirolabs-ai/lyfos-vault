# Digital Legacy Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared, versioned Digital Legacy catalogue and encrypted owner-data model without enabling credential entry, changing Circle recovery, or exposing user legacy metadata to the server.

**Architecture:** A new dependency-free `@os-one/digital-legacy` workspace package owns immutable catalogue configuration and pure model functions shared by web and mobile. User records remain a `digitalLegacy` aggregate inside the existing Stage 1 encrypted vault. Generic local SVG assets are resolved through approved brand metadata; no database migration is needed because Phase 2 adds no server-visible user data.

**Tech Stack:** JavaScript ES modules, Node test runner, npm workspaces, existing React/Vite/Expo consumers, static SVG assets.

---

### Task 1: Catalogue contracts

**Files:**
- Create: `packages/digital-legacy/package.json`
- Create: `packages/digital-legacy/src/catalogue.test.js`
- Create: `packages/digital-legacy/src/categories.js`
- Create: `packages/digital-legacy/src/fieldTemplates.js`
- Create: `packages/digital-legacy/src/services.js`
- Create: `packages/digital-legacy/src/catalogue.js`

- [ ] Write tests asserting 15 required categories plus a custom-category facility, unique IDs/slugs, valid sensitivity levels, deterministic order, service aliases, multiple required service examples, and valid field-template references.
- [ ] Run `npm test --workspace=@os-one/digital-legacy` and verify failure because package/catalogue exports do not exist.
- [ ] Implement immutable category, field-template, and service-template configuration with generic icon keys and critical-field storage disabled by policy.
- [ ] Add catalogue validation and lookup functions: `getCategory`, `getService`, `listServices`, `searchServiceTemplates`, and `validateCatalogue`.
- [ ] Re-run the package test and verify it passes.

### Task 2: Record model, classifications, permissions, and status

**Files:**
- Create: `packages/digital-legacy/src/model.test.js`
- Create: `packages/digital-legacy/src/constants.js`
- Create: `packages/digital-legacy/src/recordModel.js`
- Create: `packages/digital-legacy/src/permissions.js`
- Create: `packages/digital-legacy/src/status.js`

- [ ] Write tests for versioned aggregate creation, record normalization, prohibited field classes, feature-gated critical fields, unique record IDs, multiple records per service, owner-only enforcement marking, and deterministic statuses.
- [ ] Run the focused model test and verify the missing-module failure.
- [ ] Implement `createDigitalLegacy`, `createLegacyRecord`, `validateLegacyRecord`, `resolveReleaseIntent`, and `deriveRecordStatus` as pure functions.
- [ ] Ensure release policies created in Phase 2 are always labelled `intent_only`, never cryptographically enforced.
- [ ] Re-run the focused and full package tests.

### Task 3: Scoring, review, safe search, and priority actions

**Files:**
- Create: `packages/digital-legacy/src/score.test.js`
- Create: `packages/digital-legacy/src/score.js`
- Create: `packages/digital-legacy/src/review.js`
- Create: `packages/digital-legacy/src/search.js`

- [ ] Write tests for the 40/40/20 formula, explicit not-applicable coverage, password-independent readiness, configurable freshness bands, review dates, metadata-only search, alias search, and at-most-three priority actions.
- [ ] Run the focused test and verify failure because functions are absent.
- [ ] Implement derived coverage/readiness/freshness with score-spec versioning and calm preparation labels.
- [ ] Implement review scheduling and metadata-only record search that excludes all field values and free-text instructions.
- [ ] Implement stable priority actions capped at three.
- [ ] Re-run the focused and full package tests.

### Task 4: Legacy migration adapter

**Files:**
- Create: `packages/digital-legacy/src/migrationAdapter.test.js`
- Create: `packages/digital-legacy/src/migrationAdapter.js`

- [ ] Write fixtures for every old item type, ambiguous imports, existing IDs/timestamps/attachments, `emergencyEligible`, repeated migrations, and an existing `digitalLegacy` aggregate.
- [ ] Run the focused test and verify the missing-module failure.
- [ ] Implement non-destructive deterministic mappings only; route ambiguous types to `imported-legacy-records`.
- [ ] Preserve old `items`, mark historical emergency selection as unenforced intent, and make migration idempotent.
- [ ] Re-run focused and full package tests.

### Task 5: Public package surface and workspace wiring

**Files:**
- Create: `packages/digital-legacy/src/index.js`
- Modify: `package-lock.json`
- Modify: `package.json`
- Create: `apps/web/src/legacy/featureFlags.js`
- Create: `apps/web/src/legacy/featureFlags.test.js`

- [ ] Write a feature-flag test proving the catalogue/model flags can be enabled independently while credential and nominee-field-permission flags default to false.
- [ ] Run the feature-flag test and verify failure because the module is missing.
- [ ] Add the package export surface and safe web build-time feature flags.
- [ ] Refresh npm workspace metadata using `npm install --package-lock-only --ignore-scripts`.
- [ ] Run package tests and the web feature-flag test.

### Task 6: Generic icon and brand metadata system

**Files:**
- Create: `packages/digital-legacy/src/brandAssets.js`
- Create: `packages/digital-legacy/src/brandAssets.test.js`
- Create: `apps/web/public/assets/legacy-services/metadata.json`
- Create: `apps/web/public/assets/legacy-services/generic/*.svg`

- [ ] Write tests asserting every category/service icon resolves to local metadata, every unapproved brand uses `generic-only`, paths are local, and light/dark fallback behaviour is deterministic.
- [ ] Run the focused test and verify failure because brand assets are absent.
- [ ] Implement the resolver and metadata using a small consistent generic SVG icon set; do not add unofficial brand logos.
- [ ] Re-run focused and full package tests.

### Task 7: Phase 2 documentation

**Files:**
- Create: `docs/DIGITAL_LEGACY_ARCHITECTURE.md`
- Create: `docs/DIGITAL_LEGACY_DATA_MODEL.md`
- Create: `docs/LEGACY_SCORE_SPECIFICATION.md`
- Create: `docs/BRAND_ASSET_POLICY.md`
- Create: `docs/LEGACY_RECORD_MIGRATION.md`

- [ ] Document the encrypted-aggregate boundary, immutable catalogue, schema versions, classification rules, score examples, brand approval states, migration mapping, feature flags, rollback, and the explicit absence of a Phase 2 database migration.
- [ ] Scan documentation for `TBD`, `TODO`, contradictory enforcement claims, and unsupported security claims.

### Task 8: Verification

**Files:**
- Verify all files above; do not modify production Circle or Stage 1 crypto code.

- [ ] Run `npm test --workspace=@os-one/digital-legacy` and confirm zero failures.
- [ ] Run `npm test --workspace=@os-one/web` and confirm zero failures.
- [ ] Run `npm run check` and confirm all workspace checks exit zero.
- [ ] Run `npm run build --workspace=@os-one/web` and confirm Vite production build succeeds.
- [ ] Run `git diff --check` and inspect `git status --short` and `git diff --stat`.
- [ ] Verify no Supabase migration, Circle function, release procedure, or credential UI changed.
