# Digital Legacy Brand Asset Policy

## Phase 2 policy

Only Lyfos-created generic category icons are bundled. No service logo is represented as official or licensed.

Every service template currently declares:

- `iconSource: "generic"`
- `brandAssetApproved: false`

Every bundled asset currently declares:

- `usageStatus: "generic-only"`
- A local `/assets/legacy-services/` path.
- A source reference and review date.

## Approved states

- `approved`: legal/brand review permits the exact asset and usage.
- `pending-review`: asset is not displayed in production.
- `generic-only`: use the Lyfos generic fallback.

Phase 2 contains only `generic-only` assets. The official-icon feature flag defaults off.

## Asset requirements

- Bundle assets locally; do not hotlink.
- Do not scrape app stores, websites, favicons, or unknown icon services.
- Do not recolour or distort official logos without permission.
- Provide a light/dark variant only when it is an approved file; otherwise use the deterministic generic fallback.
- Keep service name text visible. An icon is never the sole identifier.
- SVG files must not contain scripts, event handlers, links, embedded remote images, or executable content.
- User-uploaded custom icons remain disabled until validation, metadata removal, storage, and abuse controls are designed.

## Metadata

The shared contract lives in `packages/digital-legacy/src/brandAssets.js`. The web-readable mirror is `apps/web/public/assets/legacy-services/metadata.json`.

Tests require both sources to match, require all catalogue icon keys to resolve, and inspect every SVG for forbidden active elements.

## Approval workflow

Before changing a service from `generic-only`:

1. Record the asset owner and source.
2. Record the permitted product, territory, theme, and alteration rules.
3. Store the exact approved local files.
4. Add light/dark variants only if approved.
5. Set an expiry/review date where required.
6. Enable the official-icon flag only for an approved test cohort.
7. Retain the generic fallback for missing or revoked assets.
