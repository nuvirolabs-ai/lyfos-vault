# OS-One Stage 2 Decision Lock and Implementation Plan

Date: 2026-05-04

Stage 2 scope is **trust-grade backup + recovery foundation**.

This stage does not include sync, nominee execution, cloud recovery, server-side recovery, AI capture upgrades, or model-backed extraction. The only product truth Stage 2 improves is whether a user can understand, create, verify, and safely restore an encrypted backup without false confidence.

## 1. Final Product Decisions

### Recovery key regeneration

Decision: **Supported only while the vault is unlocked.**

Justification:
- If the user can unlock the vault, the app can generate a new recovery key and rewrap the existing vault key.
- This is useful if the recovery key was exposed, printed badly, or stored in the wrong place.
- It must revoke the previous recovery envelope immediately after the new key is confirmed.

Product rule:
- Regeneration is not a rescue path.
- It cannot happen from the locked screen.
- It cannot recover a lost vault if the user has neither phrase nor current recovery key.

### Recovery key viewing after setup

Decision: **Not supported as plaintext viewing. Regenerate instead.**

Justification:
- Showing the existing recovery key after setup trains users to treat it as casually retrievable.
- In Stage 1/2, the recovery key plaintext should never be stored.
- A serious product should say: "OS-One cannot show your current recovery key again. You can replace it while unlocked."

Product rule:
- The recovery key state can show whether a recovery key exists and when it was last confirmed.
- It cannot reveal the old key.
- The only recovery-key action is replacing it with a new confirmed key.

### Backup verification after export

Decision: **Strongly recommended, not mandatory.**

Justification:
- Mandatory verification after every export creates friction and may make users avoid backups.
- But an unverified backup is lower-trust and should be labelled honestly.

Product rule:
- After export, show a primary action: "Verify this backup."
- Backup health remains "Unverified" until the user imports the exported file and decrypts it successfully.
- The app should not claim a backup is safe until it has been verified.

### Plaintext backup metadata

Decision: **Allow only non-sensitive operational metadata in the plaintext manifest.**

Allowed plaintext:
- `kind`
- `formatVersion`
- `exportedAt`
- `vaultId`
- `backupId`
- `encryptedPayloadBytes`
- `encryptedAttachmentBytes`
- `recordCount`
- `attachmentCount`
- `auditEventCount`
- `kdfName`
- `createdByAppVersion`
- `backupSchemaVersion`

Forbidden plaintext:
- record titles
- category names if they reveal life areas in future production backup format
- attachment names
- filenames
- notes
- account names
- bank names
- policy numbers
- identity document names
- nominee names
- key-holder names
- sensitive values

Justification:
- Users need enough metadata to compare and verify backups.
- Backup files may be stored in insecure places, so plaintext metadata must not reveal what is inside the vault.

### Backup reminders

Decision: **Gentle local reminders only.**

Justification:
- Aggressive reminders make the product feel alarmist.
- Silent stale backups are dangerous.

Product rule:
- Show passive backup health in the app.
- Show a calm inline warning when backup is stale.
- Do not use push notifications, email, or background reminders in Stage 2.

Reminder levels:
- Healthy: last verified backup matches or postdates current vault state.
- Needs verification: backup exported but not verified.
- Stale: vault changed meaningfully after the last verified backup.
- Missing: no backup has ever been exported.

### What counts as stale

Decision: **A backup is stale when either condition is true:**
- the current vault `updatedAt` is more than 24 hours newer than the last verified backup export time, or
- the current vault has changes after the last verified backup, including record changes, attachment changes, recovery key replacement, or restore replacement.

Justification:
- Time alone is not enough; backup staleness should be tied to vault changes.
- A 24-hour threshold avoids noisy warnings for tiny same-session edits while still making the risk visible.

### Large attachment warnings

Decision: **Supported.**

Warning thresholds:
- Soft warning at encrypted backup size above 20 MB.
- Strong warning at encrypted backup size above 100 MB.
- Per-file warning at attachment size above 10 MB if future limits allow larger files.

Stage 2 beta rule:
- If the current Stage 1 attachment limit remains 2 MB, still implement total backup-size warnings because many small attachments can create large backups.

Justification:
- Large encrypted backups are slower to export, harder to store, and more likely to fail during manual movement.

### Practice restore preview

Decision: **Separate from real restore.**

Justification:
- Users need a low-risk way to test whether a backup works.
- Real restore is destructive because it replaces local state.

Product rule:
- "Verify backup" means decrypt and inspect metadata without replacing local vault.
- "Preview restore" means decrypt and compare incoming backup against current vault without replacing.
- "Replace local vault" is a separate destructive action gated by typed confirmation.

## 2. Stage 2 User Flows

### Export backup

1. User opens Backup & Recovery.
2. UI shows current backup health before export.
3. User clicks "Export encrypted backup."
4. App computes safe manifest metadata and encrypted payload size.
5. If backup is large, UI shows a warning before download.
6. App downloads encrypted backup file.
7. App records backup export in audit.
8. App marks backup state as `exported_unverified`.
9. UI shows "Backup exported. Verify this file before relying on it."

Failure states:
- Export failed because vault is locked: ask user to unlock.
- Export failed because browser blocked download: explain that no backup was saved.
- Export failed because payload could not be serialized: keep existing backup state unchanged.

### Verify backup

1. User clicks "Verify backup."
2. User selects backup file.
3. App validates backup shape.
4. App asks for vault phrase or recovery key.
5. App decrypts backup payload.
6. App verifies payload schema and counts.
7. App shows verification result: verified, wrong key, invalid file, corrupted file, or unsupported version.
8. If verified, app stores local backup health metadata.
9. App audits backup verification success or failure without storing secrets.

Important UX rule:
- Verification never replaces local vault.

### View backup health

1. User opens Backup & Recovery or security panel.
2. UI shows one dominant state:
   - No backup yet
   - Backup exported but not verified
   - Backup verified
   - Backup stale
   - Backup file failed verification
3. UI explains the exact risk in one sentence.
4. UI shows primary next action:
   - Export backup
   - Verify backup
   - Export fresh backup
   - Try another file

### Import backup for preview only

1. User chooses "Preview a backup."
2. User selects backup file.
3. App validates shape.
4. App asks for vault phrase or recovery key.
5. App decrypts preview in memory.
6. App compares incoming metadata with current local vault where possible.
7. UI shows:
   - newer / older / same-era / unknown
   - incoming record count
   - incoming attachment count
   - incoming audit count
   - local vault record count
   - local vault attachment count
   - what would be replaced
8. User can close preview without changing anything.

### Import backup for replace

1. User completes preview first.
2. UI shows destructive replacement summary.
3. User must type `REPLACE LOCAL VAULT`.
4. App replaces local encrypted vault container.
5. App opens restored vault only after decrypt verification has already succeeded.
6. App audits restore confirmation inside restored vault.
7. App resets backup health based on restored backup metadata.

Refusal flow:
- If user cancels or closes preview, audit restore refused if the vault is unlocked.
- If locked, queue safe pending audit metadata for the next successful unlock.

### Recovery key education

1. During vault creation, user sees recovery key explanation before generation.
2. Copy states:
   - "This key can unlock your vault if you forget the vault phrase."
   - "OS-One cannot show this same key again."
   - "If you lose both phrase and recovery key, the vault cannot be recovered."
3. User must confirm the generated key.
4. After setup, Backup & Recovery shows recovery key status:
   - configured
   - last confirmed date
   - replace available while unlocked

### Recovery key replace/regenerate

1. User opens Backup & Recovery while unlocked.
2. User chooses "Replace recovery key."
3. UI explains the old recovery key will stop working after confirmation.
4. App generates a new recovery key.
5. User must confirm the new key.
6. App rewraps vault key with the new recovery key.
7. App removes old recovery envelope.
8. App saves encrypted vault container.
9. App audits recovery key replacement.
10. UI recommends exporting and verifying a fresh backup.

Failure states:
- User cancels before confirmation: old key remains active.
- Save fails: old key remains active.
- User locks during flow: generated key is discarded.

### Stale backup warning

1. User changes vault after last verified backup.
2. App marks backup health as stale if staleness criteria are met.
3. UI shows calm warning:
   - "Your vault has changed since the last verified backup."
4. Primary action: "Export fresh backup."
5. Secondary action: "Verify existing backup."

## 3. Stage 2 State Model

### Backup health states

States:
- `missing`
- `exported_unverified`
- `verified_current`
- `verified_stale`
- `verification_failed`
- `unknown_after_restore`

Transitions:
- `missing` -> `exported_unverified` after successful export.
- `exported_unverified` -> `verified_current` after successful verification matching current vault generation.
- `exported_unverified` -> `verification_failed` after failed verification.
- `verified_current` -> `verified_stale` after qualifying vault change or 24-hour staleness threshold.
- `verified_stale` -> `exported_unverified` after fresh export.
- any state -> `unknown_after_restore` after restore when backup provenance cannot be matched.
- `unknown_after_restore` -> `verified_current` after successful verification of a backup matching restored vault.

Stored backup health fields:
- `status`
- `lastExportedAt`
- `lastVerifiedAt`
- `lastVerifiedBackupId`
- `lastVerifiedVaultUpdatedAt`
- `lastVerifiedRecordCount`
- `lastVerifiedAttachmentCount`
- `lastVerificationFailureReason`
- `lastKnownEncryptedPayloadBytes`

### Verification state

States:
- `idle`
- `file_selected`
- `shape_validating`
- `secret_required`
- `decrypting`
- `verified`
- `wrong_secret`
- `invalid_shape`
- `unsupported_version`
- `corrupted_payload`
- `cancelled`

Transitions:
- `idle` -> `file_selected` after file selection.
- `file_selected` -> `shape_validating`.
- `shape_validating` -> `secret_required` when manifest is valid.
- `shape_validating` -> `invalid_shape` or `unsupported_version` on failure.
- `secret_required` -> `decrypting` after phrase/recovery key entry.
- `decrypting` -> `verified` on success.
- `decrypting` -> `wrong_secret` or `corrupted_payload` on failure.
- any active state -> `cancelled` when user closes flow.

### Restore preview state

States:
- `idle`
- `file_selected`
- `shape_validating`
- `secret_required`
- `decrypting_preview`
- `preview_ready`
- `replace_confirmation_required`
- `replacing`
- `restore_complete`
- `restore_refused`
- `restore_failed`

Transitions:
- `idle` -> `file_selected`.
- `file_selected` -> `shape_validating`.
- `shape_validating` -> `secret_required` if valid.
- `secret_required` -> `decrypting_preview`.
- `decrypting_preview` -> `preview_ready`.
- `preview_ready` -> `replace_confirmation_required` when user chooses replace.
- `preview_ready` -> `restore_refused` when user cancels.
- `replace_confirmation_required` -> `replacing` only after exact typed confirmation.
- `replacing` -> `restore_complete` on local replacement success.
- `replacing` -> `restore_failed` on persistence failure.

### Recovery key state

States:
- `not_configured`
- `configured_confirmed`
- `replacement_started`
- `replacement_confirmation_required`
- `replacement_saving`
- `replacement_complete`
- `replacement_cancelled`
- `replacement_failed`

Transitions:
- `not_configured` -> `configured_confirmed` during vault creation.
- `configured_confirmed` -> `replacement_started` while unlocked.
- `replacement_started` -> `replacement_confirmation_required` after new key generation.
- `replacement_confirmation_required` -> `replacement_saving` after exact confirmation.
- `replacement_confirmation_required` -> `replacement_cancelled` if cancelled or vault locks.
- `replacement_saving` -> `replacement_complete` on save success.
- `replacement_saving` -> `replacement_failed` if save fails.
- `replacement_complete` -> `configured_confirmed`.

## 4. Stage 2 Module Plan

### Files to create

- `apps/web/src/lib/stage2BackupManifest.js`
  - Build safe plaintext backup manifest.
  - Strip all sensitive names/titles/filenames from plaintext metadata.
  - Compute encrypted payload byte counts.
  - Validate Stage 2 manifest shape.

- `apps/web/src/lib/stage2BackupHealth.js`
  - Derive backup health status.
  - Compare current vault state with last verified backup state.
  - Detect stale backup conditions.
  - Generate user-facing health copy.

- `apps/web/src/lib/stage2RecoveryKey.js`
  - Generate replacement recovery key.
  - Confirm replacement key.
  - Rewrap vault key with new recovery envelope.
  - Refuse replacement when vault is locked.

- `apps/web/src/lib/stage2BackupManifest.test.js`
  - Tests safe plaintext fields and forbidden metadata leakage.

- `apps/web/src/lib/stage2BackupHealth.test.js`
  - Tests health states, stale transitions, and copy.

- `apps/web/src/lib/stage2RecoveryKey.test.js`
  - Tests replacement success, cancellation, wrong confirmation, and old-key revocation behavior.

### Files to change

- `apps/web/src/lib/stage1Crypto.js`
  - Add Stage 2-compatible backup export wrapper while preserving Stage 1 unlock compatibility.
  - Add recovery envelope replacement function if not better isolated in Stage 2 recovery module.

- `apps/web/src/lib/stage1Crypto.test.js`
  - Add regression tests that old Stage 1 vaults still unlock.
  - Add tests for new recovery envelope replacement if crypto-level changes live here.

- `apps/web/src/lib/stage1Store.js`
  - Add local backup health metadata persistence.
  - Keep backup health separate from encrypted vault contents if it contains no secrets.

- `apps/web/src/lib/stage1Store.test.js`
  - Test backup health persistence and clearing behavior.

- `apps/web/src/main.jsx`
  - Add Backup & Recovery surface.
  - Add verify backup flow.
  - Add practice preview flow.
  - Add real restore replacement confirmation copy.
  - Add recovery key replacement flow.
  - Add stale backup warning.

- `apps/web/src/lib/stage1Audit.js`
  - Add audit event labels for backup verification and recovery key replacement.

- `apps/web/src/lib/stage1Audit.test.js`
  - Verify new audit labels are human-readable and secret-free.

### Test coverage needed

Backup manifest:
- Manifest includes allowed plaintext metadata.
- Manifest excludes record titles.
- Manifest excludes attachment names.
- Manifest excludes category labels if Stage 2 moves them out of plaintext.
- Manifest rejects unsupported versions.
- Manifest rejects missing encrypted payload.

Backup health:
- No backup -> missing.
- Exported but not verified -> exported unverified.
- Verified matching current vault -> current.
- Vault changed after verification -> stale.
- More than 24 hours newer than verified backup -> stale.
- Verification failure -> failed.
- Restore with unknown provenance -> unknown after restore.

Verification:
- Valid backup + correct phrase -> verified.
- Valid backup + correct recovery key -> verified.
- Valid backup + wrong phrase -> wrong secret.
- Corrupt encrypted payload -> corrupted payload.
- Invalid JSON -> invalid shape.
- Unsupported version -> unsupported version.
- Verification does not replace local state.

Restore:
- Preview does not replace local vault.
- Replace requires exact `REPLACE LOCAL VAULT`.
- Cancelled preview does not change local vault.
- Restore confirmed updates local encrypted record.
- Restore refused is audited where possible.

Recovery key:
- Existing recovery key cannot be viewed.
- Replacement requires unlocked vault.
- New key must be confirmed exactly.
- Old recovery key stops working after replacement.
- New recovery key unlocks after replacement.
- Cancelled replacement keeps old key active.
- Lock during replacement discards new key.

Audit:
- backup export
- backup verification success
- backup verification failure
- restore preview
- restore refused
- restore confirmed
- recovery key replacement started
- recovery key replacement completed
- recovery key replacement cancelled

### Data structures needed

#### Stage 2 backup manifest

```js
{
  kind: "os-one-encrypted-backup",
  backupSchemaVersion: 2,
  backupId: "uuid",
  vaultId: "uuid",
  exportedAt: "ISO-8601",
  createdByAppVersion: "stage2-beta",
  encryptedPayloadBytes: 12345,
  encryptedAttachmentBytes: 67890,
  recordCount: 12,
  attachmentCount: 4,
  auditEventCount: 31,
  kdfName: "PBKDF2-SHA256",
  encryptedVaultContainer: {}
}
```

#### Backup health metadata

```js
{
  status: "missing",
  lastExportedAt: null,
  lastVerifiedAt: null,
  lastVerifiedBackupId: null,
  lastVerifiedVaultUpdatedAt: null,
  lastVerifiedRecordCount: 0,
  lastVerifiedAttachmentCount: 0,
  lastVerificationFailureReason: null,
  lastKnownEncryptedPayloadBytes: 0
}
```

#### Recovery key metadata

```js
{
  status: "configured_confirmed",
  confirmedAt: "ISO-8601",
  lastReplacedAt: null,
  canViewExistingKey: false,
  canReplaceWhileUnlocked: true
}
```

### Migration and versioning needs

- Stage 1 encrypted containers must continue to import and unlock.
- Stage 2 backup manifest wraps the existing encrypted vault container rather than changing vault encryption immediately.
- Backup import must detect:
  - Stage 1 direct encrypted vault container.
  - Stage 2 backup manifest wrapping encrypted vault container.
- If Stage 1 backup is imported, UI labels it as "older backup format" but can still verify/preview/restore.
- Backup health metadata can be reset without damaging vault data.
- Recovery key replacement should update the encrypted vault container version or metadata revision.

## 5. Stage 2 Success Criteria

Stage 2 is complete only when all of the following are true:

1. A user can export an encrypted backup and understands it is not verified yet.
2. A user can verify a backup without replacing local data.
3. A user can preview a restore without replacing local data.
4. A user cannot accidentally replace the local vault from preview.
5. The app clearly shows whether backup health is missing, unverified, current, stale, failed, or unknown.
6. Backup plaintext metadata contains no record titles, attachment names, filenames, bank names, ID names, nominee names, or sensitive values.
7. A user can replace the recovery key while unlocked.
8. The old recovery key stops working after confirmed replacement.
9. The new recovery key unlocks the vault after confirmed replacement.
10. The app never claims it can recover a vault if both phrase and recovery key are lost.
11. Backup verification, verification failure, restore preview, restore refusal, restore confirmation, and recovery key replacement are audited without secrets.
12. Stage 1 backups remain importable.
13. Tests cover manifest safety, backup health, verify-only behavior, destructive restore gating, and recovery key replacement.
14. The Backup & Recovery UI has one clear next action for each health state.
15. No Stage 2 screen implies cloud sync, server recovery, or nominee execution exists.

## Recommended Implementation Order

1. Add Stage 2 backup manifest tests.
2. Build manifest creation and validation.
3. Add backup health state tests.
4. Build backup health derivation and persistence.
5. Add verify-only backup tests.
6. Implement verify-only backup flow.
7. Add practice restore preview tests.
8. Separate preview-only restore from destructive replace in UI.
9. Add recovery key replacement tests.
10. Implement recovery key replacement while unlocked.
11. Add audit labels and tests.
12. Wire Backup & Recovery UI.
13. Retest Stage 1 create/unlock/export/import/restore path for regressions.

## Explicit Non-Goals

- No sync.
- No cloud drive integration.
- No server recovery.
- No hidden escrow.
- No nominee execution.
- No key-holder approval.
- No owner alert delivery.
- No AI capture upgrade.
- No production native secure storage migration.
