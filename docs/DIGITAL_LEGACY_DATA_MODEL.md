# Digital Legacy Data Model

## Versions

- Aggregate schema: `1`
- Catalogue: `2026.08.1`
- Score specification: `1.0`

These versions are stored inside the encrypted aggregate so later clients can select a compatible adapter without exposing user data to the server.

## Aggregate

```ts
type DigitalLegacy = {
  schemaVersion: 1;
  catalogueVersion: "2026.08.1";
  scoreSpecVersion: "1.0";
  createdAt: string;
  updatedAt: string;
  categoryReviews: CategoryReview[];
  customCategories: CustomCategory[];
  customServices: CustomService[];
  records: LegacyRecord[];
};
```

`ownerUserId` is intentionally absent. Ownership is already established by the encrypted vault container and its owner-scoped database row.

## Legacy record

```ts
type LegacyRecord = {
  id: string;
  categoryId: string;
  serviceTemplateId?: string;
  customCategoryId?: string;
  customServiceId?: string;
  accountLabel: string;
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
  releasePolicy: ReleaseIntent;
  review: ReviewState;
  attachments: EncryptedAttachment[];
  status: LegacyRecordStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  releasedAt?: string;
};
```

Multiple records may share one `serviceTemplateId`. Account identity belongs to the record ID, not the service template.

## Fields and classifications

```ts
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
  revealPolicy: "normal" | "recent_auth";
  copyPolicy: "confirm" | "disabled";
};
```

All field values are encrypted by the containing Stage 1 vault. `encrypted: true` in a template describes this storage boundary; it does not mean each field has a separate key.

Storage policies:

- `allowed`: available when secure create/edit is implemented.
- `feature_gated`: password, PIN, and recovery-code classes; disabled by default.
- `disabled_pending_review`: seed phrases, private keys, and password-manager master passwords.
- `prohibited`: OTPs, temporary authentication codes, and full payment-card CVVs.

Custom field names cannot be used to bypass the prohibited OTP/temporary-code/CVV policy. Custom secret classifications use the same gates as built-in templates.

## Status

Status is derived, not trusted mutable input:

- `started`
- `protected`
- `incomplete`
- `needs_review`
- `action_required`
- `scheduled_for_release`
- `released`
- `archived`

`scheduled_for_release` represents owner intent only in the current architecture. UI copy must not imply cryptographic record isolation.

## Review state

```ts
type ReviewState = {
  frequency: "3_months" | "6_months" | "yearly" | "custom" | "none";
  customDays?: number;
  lastReviewedAt?: string;
  nextReviewAt?: string;
};
```

Review confirmation updates review timestamps without reading, returning, or changing field values.

## Search boundary

Approved record search inputs:

- Service name and aliases.
- Account label.
- Category name.
- Tags.
- Derived status.

The search function never examines `fields`, custom instructions, attachment names/content, usernames, account numbers, passwords, PINs, recovery values, private keys, or notes.

## Validation rules

- Built-in services must belong to the selected built-in category.
- User-created records use the `custom` catalogue facility and encrypted owner-scoped custom IDs.
- Unknown fields and mismatched classifications are rejected.
- Prohibited fields are rejected even if present in a manually constructed record.
- Release enforcement must be `intent_only` in schema version 1.
- Secure identifiers fail closed when a cryptographic UUID source is unavailable.
