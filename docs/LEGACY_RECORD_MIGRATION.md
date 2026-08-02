# Legacy Record Migration

## Phase 2 behaviour

`migrateLegacyVault` creates a versioned `vault.digitalLegacy` index without deleting, rewriting, or duplicating `vault.items`.

Sensitive legacy fields and attachment data URLs are not copied into new fields. Each imported record points back to its original item with `legacyItemId` and attachment IDs. The old encrypted item remains the canonical content until the owner reviews it in a later migration phase.

## Deterministic mappings

| Old type | Category | Service template |
| --- | --- | --- |
| `bank_account` | Banking and payments | Other bank |
| `card` | Banking and payments | Other payment account |
| `email_account` | Email and communication | Other communication account |
| `identity_document` | Government and identity | Other government identity |
| `insurance_policy` | Insurance | Other insurance |

These mappings identify the broad category without guessing a provider.

## Owner-review mappings

The following types are ambiguous and enter the owner-created **Imported legacy records** category:

- `password`
- `pin`
- `important_document`
- `emergency_instruction`
- Any unknown future type

Lyfos must ask the owner to classify these later. A password could belong to email, banking, social, business, a device, or another category; an important document could be identity, property, health, insurance, or personal.

## Preserved data

- Original item ID becomes the imported record ID and `legacyItemId`.
- Original creation/update timestamps are retained when valid.
- Original item content stays unchanged in `vault.items`.
- Attachment IDs are referenced without duplicating attachment bytes.
- `emergencyEligible` is retained as `migration.historicalEmergencyEligible`.

An old `emergencyEligible: true` becomes `instructions_only` release intent; false becomes `owner_only`. Both are marked `enforcement: "intent_only"`. This is historical intent, not proof that current whole-vault recovery excludes any item.

## Idempotency

If `vault.digitalLegacy` already exists, the adapter returns it unchanged and reports `digital_legacy_already_present`. It never merges or overwrites an existing aggregate automatically.

## Production migration gates

The adapter is a Phase 2 library and is not called by the production vault yet. Production activation requires:

1. A verified encrypted pre-migration backup.
2. Compare-and-swap sync revisions so old clients cannot overwrite the new aggregate.
3. Web/mobile compatibility fixtures.
4. Active Circle recovery handling.
5. Attachment-capacity checks.
6. A feature-flagged preview and explicit owner review.
7. Tested rollback that renders the untouched `vault.items` collection.

No Supabase database migration is required for this client-side encrypted aggregate.
