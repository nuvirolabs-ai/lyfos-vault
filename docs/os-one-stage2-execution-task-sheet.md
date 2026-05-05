# OS-One Stage 2 Execution Task Sheet

Date: 2026-05-04

Stage 2 scope: **trust-grade backup + recovery foundation only**.

Non-goals for every slice:
- no sync
- no nominee execution
- no key-holder workflow
- no AI capture upgrade
- no server recovery
- no cloud-drive integration
- no hidden escrow

## 1. Implementation Slices

1. Backup manifest and versioning foundation
2. Backup verification flow
3. Backup health state
4. Recovery key education and replacement flow
5. Restore preview refinement
6. Staleness and reminder logic
7. Payload-size warnings
8. Final retest

## 2. Per-Slice Module Plan

### Slice 1: Backup Manifest and Versioning Foundation

Purpose: create a Stage 2 backup wrapper that exposes only safe operational metadata while preserving Stage 1 backup compatibility.

Files to create:
- `apps/web/src/lib/stage2BackupManifest.js`
- `apps/web/src/lib/stage2BackupManifest.test.js`

Files to change:
- `apps/web/src/lib/stage1Crypto.js`
- `apps/web/src/lib/stage1Crypto.test.js`
- `apps/web/src/lib/stage1Store.js`
- `apps/web/src/lib/stage1Store.test.js`

Functions to add:
- `createStage2BackupManifest({ encryptedVaultContainer, vaultSnapshot, exportedAt, appVersion })`
- `validateStage2BackupManifest(value)`
- `isStage2BackupManifest(value)`
- `normalizeImportedBackup(value)`
- `getBackupFormatLabel(value)`
- `getEncryptedByteSize(value)`

Data structures/state additions:
- `kind: "os-one-encrypted-backup"`
- `backupSchemaVersion: 2`
- `backupId`
- `vaultId`
- `exportedAt`
- `createdByAppVersion`
- `encryptedPayloadBytes`
- `encryptedAttachmentBytes`
- `recordCount`
- `attachmentCount`
- `auditEventCount`
- `kdfName`
- `encryptedVaultContainer`

Tests required:
- Creates valid Stage 2 manifest around existing encrypted vault container.
- Rejects missing encrypted container.
- Rejects unsupported manifest version.
- Accepts direct Stage 1 container through `normalizeImportedBackup`.
- Excludes record titles from manifest JSON.
- Excludes attachment names and filenames from manifest JSON.
- Excludes category labels from manifest JSON.
- Excludes sensitive values, notes, nominee names, and account names from manifest JSON.
- Computes encrypted payload byte counts consistently.

Migration/versioning implications:
- Stage 1 direct backups remain importable.
- Stage 2 backups wrap the existing Stage 1 encrypted vault container.
- No vault payload migration is required in this slice.

Acceptance criteria:
- Exported Stage 2 backup file contains safe manifest metadata and encrypted container.
- Stage 1 backup file can still be imported.
- Manifest plaintext inspection shows no sensitive names, titles, filenames, or values.
- Existing Stage 1 unlock tests continue to pass.

Risk checks:
- Do not leak record names through manifest counts or labels.
- Do not call the manifest "safe backup" before verification exists.
- Do not change encryption primitives in this slice.

Stop conditions:
- Stop if implementation requires backend storage.
- Stop if UI copy suggests cloud backup exists.
- Stop if manifest needs category or filename plaintext to feel useful.

### Slice 2: Backup Verification Flow

Purpose: allow users to verify an exported backup by decrypting it without replacing local vault state.

Files to create:
- `apps/web/src/lib/stage2BackupVerification.js`
- `apps/web/src/lib/stage2BackupVerification.test.js`

Files to change:
- `apps/web/src/main.jsx`
- `apps/web/src/lib/stage1Audit.js`
- `apps/web/src/lib/stage1Audit.test.js`

Functions/hooks/components to add:
- `verifyBackup({ backupText, secret, mode })`
- `classifyBackupVerificationError(error)`
- `BackupVerificationPanel`
- `BackupFilePicker`
- `BackupSecretPrompt`
- `BackupVerificationResult`

Data structures/state additions:
- `verificationState`
- `selectedBackupText`
- `verificationResult`
- `verificationError`
- `verificationMode: "phrase" | "recoveryKey"`

Tests required:
- Valid Stage 2 backup plus correct phrase verifies.
- Valid Stage 2 backup plus correct recovery key verifies.
- Stage 1 backup plus correct phrase verifies.
- Wrong phrase returns `wrong_secret`.
- Invalid JSON returns `invalid_shape`.
- Unsupported manifest returns `unsupported_version`.
- Corrupted encrypted payload returns `corrupted_payload`.
- Verification does not call local vault replacement.
- Verification success/failure audit labels are secret-free.

Migration/versioning implications:
- Verification must support Stage 1 direct backups and Stage 2 manifest backups.
- Verification result should include `formatVersion` and `backupSchemaVersion` when available.

Acceptance criteria:
- User can pick a backup and verify it without replacing local state.
- Verification result clearly says "verified" or exact failure reason.
- Failure states do not imply data loss.
- Audit shows verification success/failure without exposing the entered secret.

Risk checks:
- Do not write imported backup into local storage during verification.
- Do not show decrypted record names in the verification result.
- Do not imply that a verified old backup is current.

Stop conditions:
- Stop if verification needs cloud storage.
- Stop if verification starts acting like restore.
- Stop if UI implies OS-One can repair corrupted backups.

### Slice 3: Backup Health State

Purpose: show whether the user's backup posture is missing, unverified, current, stale, failed, or unknown after restore.

Files to create:
- `apps/web/src/lib/stage2BackupHealth.js`
- `apps/web/src/lib/stage2BackupHealth.test.js`

Files to change:
- `apps/web/src/lib/stage1Store.js`
- `apps/web/src/lib/stage1Store.test.js`
- `apps/web/src/main.jsx`

Functions/hooks/components to add:
- `createDefaultBackupHealth()`
- `deriveBackupHealth({ currentVault, storedHealth, now })`
- `markBackupExported({ health, manifest })`
- `markBackupVerified({ health, verificationResult, currentVault })`
- `markBackupVerificationFailed({ health, reason, now })`
- `markBackupUnknownAfterRestore({ health, now })`
- `getBackupHealthCopy(health)`
- `BackupHealthPanel`

Data structures/state additions:
- `backupHealth.status`
- `backupHealth.lastExportedAt`
- `backupHealth.lastVerifiedAt`
- `backupHealth.lastVerifiedBackupId`
- `backupHealth.lastVerifiedVaultUpdatedAt`
- `backupHealth.lastVerifiedRecordCount`
- `backupHealth.lastVerifiedAttachmentCount`
- `backupHealth.lastVerificationFailureReason`
- `backupHealth.lastKnownEncryptedPayloadBytes`

Tests required:
- Default state is `missing`.
- Export moves state to `exported_unverified`.
- Successful verification moves state to `verified_current`.
- Verification failure moves state to `verification_failed`.
- Vault change after verification moves state to `verified_stale`.
- Restore with unknown provenance moves state to `unknown_after_restore`.
- Health copy has one clear next action for each state.

Migration/versioning implications:
- Backup health is local metadata separate from encrypted vault content.
- Clearing local vault should clear backup health.
- Importing older Stage 1 backup can set health to `unknown_after_restore`.

Acceptance criteria:
- Backup & Recovery area shows one dominant health state.
- User always sees one primary next action.
- Health state persists across browser refresh.
- Health state never exposes record titles or attachment names.

Risk checks:
- Do not label unverified export as protected.
- Do not hide stale status after vault changes.
- Do not make health copy sound like cloud monitoring.

Stop conditions:
- Stop if reminders require notifications, email, background jobs, or server state.
- Stop if health state requires sync metadata.

### Slice 4: Recovery Key Education and Replacement Flow

Purpose: teach recovery-key truth and allow replacement only while unlocked, without ever showing the existing key.

Files to create:
- `apps/web/src/lib/stage2RecoveryKey.js`
- `apps/web/src/lib/stage2RecoveryKey.test.js`

Files to change:
- `apps/web/src/lib/stage1Crypto.js`
- `apps/web/src/lib/stage1Crypto.test.js`
- `apps/web/src/main.jsx`
- `apps/web/src/lib/stage1Audit.js`
- `apps/web/src/lib/stage1Audit.test.js`

Functions/hooks/components to add:
- `createRecoveryKeyMetadata({ confirmedAt })`
- `startRecoveryKeyReplacement({ vaultKey })`
- `confirmRecoveryKeyReplacement({ encryptedRecord, vaultKey, newRecoveryKey, confirmation })`
- `cancelRecoveryKeyReplacement()`
- `RecoveryKeyEducationPanel`
- `RecoveryKeyStatusPanel`
- `RecoveryKeyReplacementFlow`

Data structures/state additions:
- `recoveryKey.status`
- `recoveryKey.confirmedAt`
- `recoveryKey.lastReplacedAt`
- `recoveryKey.canViewExistingKey: false`
- `recoveryKey.canReplaceWhileUnlocked: true`
- `recoveryReplacementState`
- `generatedReplacementKey`

Tests required:
- Existing recovery key cannot be viewed.
- Replacement is refused when vault is locked.
- New key must be confirmed exactly.
- Cancelled replacement keeps old recovery key active.
- Confirmed replacement makes old recovery key fail.
- Confirmed replacement makes new recovery key unlock.
- Lock during replacement discards generated key.
- Recovery key replacement audit is secret-free.

Migration/versioning implications:
- Existing Stage 1 vaults with recovery envelope remain valid.
- Confirmed replacement updates the recovery envelope only.
- No normal vault payload migration is required.

Acceptance criteria:
- UI clearly says OS-One cannot show the current recovery key again.
- User can replace recovery key only while unlocked.
- Old recovery key stops working after confirmed replacement.
- New recovery key unlocks the vault after lock.
- UI recommends exporting and verifying a fresh backup after replacement.

Risk checks:
- Do not imply replacement helps if both phrase and recovery key are already lost.
- Do not persist generated replacement key before confirmation.
- Do not show old recovery key.

Stop conditions:
- Stop if implementation asks for server recovery.
- Stop if recovery key starts behaving like account password reset.
- Stop if replacement requires storing recovery key plaintext.

### Slice 5: Restore Preview Refinement

Purpose: separate low-risk preview from destructive replace and make restore consequences impossible to miss.

Files to create:
- `apps/web/src/lib/stage2RestorePreview.js`
- `apps/web/src/lib/stage2RestorePreview.test.js`

Files to change:
- `apps/web/src/main.jsx`
- `apps/web/src/lib/stage1Restore.test.js`
- `apps/web/src/lib/stage1Audit.js`
- `apps/web/src/lib/stage1Audit.test.js`

Functions/hooks/components to add:
- `createRestoreDryRun({ backupText, secret, mode, currentRecord })`
- `compareRestoreImpact({ incomingVault, currentVault, incomingManifest })`
- `getRestoreImpactCopy(impact)`
- `PracticeRestorePreview`
- `RestoreImpactSummary`
- `DestructiveRestoreConfirm`

Data structures/state additions:
- `restorePreviewState`
- `restoreImpact`
- `typedRestoreConfirmation`
- `restorePreviewSourceFormat`

Tests required:
- Preview decrypts Stage 2 manifest without replacing local vault.
- Preview decrypts Stage 1 direct backup without replacing local vault.
- Preview shows older/newer/same-era/unknown.
- Preview shows incoming and current counts.
- Replace requires exact `REPLACE LOCAL VAULT`.
- Refusing preview does not replace local vault.
- Confirmed replace updates local vault.
- Restore refusal and confirmation audits are secret-free.

Migration/versioning implications:
- Existing Stage 1 restore path must become one path inside preview/refuse/replace.
- Stage 1 direct backup remains supported.
- Restore from unknown format remains refused.

Acceptance criteria:
- User can practice restore without changing local state.
- User cannot accidentally replace local vault.
- Destructive replacement copy says exactly what will be replaced.
- Restore confirmed opens the restored vault only after decrypt verification.

Risk checks:
- Do not show decrypted record names in preview unless already unlocked and explicitly needed.
- Do not make preview feel like recovery success if backup is stale.
- Do not allow one-click replace.

Stop conditions:
- Stop if restore preview adds cloud import.
- Stop if restore preview adds nominee or release concepts.
- Stop if preview attempts automatic merge.

### Slice 6: Staleness and Reminder Logic

Purpose: make stale backup risk visible without aggressive notifications or background behavior.

Files to create:
- `apps/web/src/lib/stage2BackupReminders.js`
- `apps/web/src/lib/stage2BackupReminders.test.js`

Files to change:
- `apps/web/src/lib/stage2BackupHealth.js`
- `apps/web/src/lib/stage2BackupHealth.test.js`
- `apps/web/src/main.jsx`

Functions/hooks/components to add:
- `isBackupStale({ currentVaultUpdatedAt, lastVerifiedVaultUpdatedAt, now })`
- `getBackupReminderLevel(health)`
- `getBackupReminderCopy(health)`
- `BackupStaleNotice`

Data structures/state additions:
- `backupHealth.lastVaultChangeReason`
- `backupHealth.lastReminderShownAt`

Tests required:
- Vault updated more than 24 hours after verified backup becomes stale.
- Record change after verification becomes stale.
- Attachment change after verification becomes stale.
- Recovery key replacement after verification becomes stale.
- Restore replacement moves backup health to unknown or stale as appropriate.
- Reminder copy stays calm and does not mention cloud/server behavior.

Migration/versioning implications:
- Existing users without health metadata start at `missing`.
- Existing verified state without `lastVaultChangeReason` still derives stale from timestamps.

Acceptance criteria:
- Stale backup warning appears only when criteria are met.
- Warning has one primary action: export fresh backup.
- Warning does not use notification-style alarm language.
- No browser notifications, email prompts, or background reminders are introduced.

Risk checks:
- Do not nag after every minor same-session edit unless stale criteria are met.
- Do not imply backups update themselves.
- Do not imply stale backup is unusable; it is just not current.

Stop conditions:
- Stop if reminders require push notifications.
- Stop if reminders require server jobs.
- Stop if logic starts resembling sync status.

### Slice 7: Payload-Size Warnings

Purpose: warn users when encrypted backups may be slow, heavy, or harder to move safely.

Files to create:
- `apps/web/src/lib/stage2BackupSize.js`
- `apps/web/src/lib/stage2BackupSize.test.js`

Files to change:
- `apps/web/src/lib/stage2BackupManifest.js`
- `apps/web/src/lib/stage2BackupManifest.test.js`
- `apps/web/src/main.jsx`

Functions/hooks/components to add:
- `getBackupSizeWarning({ encryptedPayloadBytes, encryptedAttachmentBytes })`
- `formatBackupSize(bytes)`
- `BackupSizeNotice`

Data structures/state additions:
- `backupSizeWarning.level: "none" | "soft" | "strong"`
- `backupSizeWarning.totalBytes`
- `backupSizeWarning.copy`

Tests required:
- No warning below 20 MB.
- Soft warning at 20 MB and above.
- Strong warning at 100 MB and above.
- Warning uses encrypted byte size, not plaintext filenames.
- Size formatting is readable.

Migration/versioning implications:
- Stage 2 manifest should include encrypted byte sizes for future compatibility.
- Stage 1 direct backup can estimate size from serialized encrypted container.

Acceptance criteria:
- Large backup warning appears before export download.
- Warning does not block export.
- Warning explains performance/storage risk, not security failure.
- Warning does not list attachment filenames.

Risk checks:
- Do not imply large backup is less encrypted.
- Do not expose attachment names or types in warning.
- Do not force users into cloud storage suggestions.

Stop conditions:
- Stop if warning suggests Google Drive, Dropbox, or cloud sync.
- Stop if large backup handling adds upload behavior.

### Slice 8: Final Retest

Purpose: prove Stage 2 improved backup/recovery trust without regressing Stage 1.

Files to create:
- none required

Files to change:
- only failing tests or trust regressions discovered during retest

Functions/hooks/components to add:
- none unless required to fix a discovered bug

Data structures/state additions:
- none unless required to fix a discovered bug

Tests required:
- Run `npm test -w @os-one/web`.
- Run `npm run check`.
- Browser retest full Stage 1 + Stage 2 journey.

Manual retest path:
1. Create a fresh vault.
2. Confirm recovery key.
3. Add records and attachments.
4. Export Stage 2 encrypted backup.
5. Confirm health becomes unverified.
6. Verify exported backup with phrase.
7. Confirm health becomes current.
8. Change vault data.
9. Confirm health becomes stale when criteria are met.
10. Preview backup restore without replacement.
11. Refuse restore.
12. Preview again and confirm replace with `REPLACE LOCAL VAULT`.
13. Confirm audit shows export, verify, preview, refuse, restore.
14. Replace recovery key while unlocked.
15. Lock vault.
16. Confirm old recovery key fails.
17. Confirm new recovery key unlocks.
18. Confirm app never claims server recovery or sync exists.

Migration/versioning implications:
- Test Stage 1 direct backup import.
- Test Stage 2 manifest backup import.
- Test fresh vault with no backup health metadata.

Acceptance criteria:
- All automated tests pass.
- Build passes.
- Browser retest completes without dead states.
- User can understand backup health, verification, restore preview, and recovery key replacement.
- No Stage 2 UI implies cloud sync, nominee execution, AI capture, or server recovery.

Risk checks:
- Clean UI is not enough; verify destructive paths are gated.
- Verified backup does not mean current backup after vault changes.
- Recovery key replacement must not look like account recovery.

Stop conditions:
- Stop if final retest reveals a Stage 1 trust regression.
- Stop if any new screen suggests capabilities outside Stage 2.
- Stop if backup/recovery behavior becomes confusing enough to require product decision changes.

## 3. Acceptance Criteria Summary

Stage 2 is complete only when:

- Stage 2 backup manifest exists and leaks no sensitive plaintext metadata.
- Stage 1 backups remain importable.
- Backup verification works without replacing local vault.
- Backup health states are visible and persistent.
- Recovery key can be replaced while unlocked.
- Existing recovery key cannot be viewed after setup.
- Old recovery key fails after replacement.
- New recovery key unlocks after replacement.
- Restore preview is separate from destructive restore.
- Destructive restore requires exact typed confirmation.
- Stale backup warnings are calm, local, and accurate.
- Large backup warnings appear before export when thresholds are crossed.
- Audit covers backup export, verification, verification failure, restore preview/refusal/confirmation, and recovery key replacement.
- Tests and build pass.
- Browser retest confirms no stale sensitive UI and no false security language.

## 4. Risk Checks Summary

Trust-damaging mistakes to actively reject:

- calling an exported backup safe before verification
- leaking record titles or attachment names in plaintext manifest
- making recovery key replacement sound like lost-key rescue
- allowing preview to replace data
- implying cloud sync exists
- implying OS-One can recover a vault without phrase or recovery key
- implying backup verification updates the backup automatically
- implying stale backup is broken rather than simply not current
- adding notification or server language to local reminders

## 5. Stop Conditions Summary

Stop implementation immediately if a slice starts requiring:

- backend account state
- cloud storage
- sync conflict handling
- nominee workflows
- key-holder workflows
- owner alerts
- AI document understanding
- server-side recovery
- hidden escrow
- plaintext backup exports
- plaintext recovery key storage

If any of those appear necessary, Stage 2 scope has been violated and the work must return to product decision review before code continues.
