# OS-One Stage 1 Execution Plan

Date: 2026-05-03

## Stage 1 Milestone Breakdown

1. **Vault crypto foundation**
   - Random vault key generated on device.
   - Vault phrase wraps the vault key.
   - Recovery key wraps the same vault key.
   - Account login is not part of decryption.

2. **Local persistence**
   - Store only encrypted vault records in browser storage for web beta.
   - Validate imported backups before replacing local state.
   - Clear local state explicitly.

3. **Unlock / lock session flow**
   - Unlock with vault phrase.
   - Unlock with recovery key if configured.
   - Keep decrypted vault only in React session memory.
   - Relock clears vault key and decrypted vault from memory.

4. **Recovery key flow**
   - Generate high-entropy user-held recovery key.
   - Require confirmation before vault creation.
   - Use recovery key only to unwrap vault key.
   - Do not imply OS-One can recreate it.

5. **Backup / restore**
   - Export encrypted Stage 1 vault container.
   - Restore only valid OS-One Stage 1 backups.
   - Require vault phrase or recovery key after import.

6. **Audit trail**
   - Store local audit events inside encrypted vault payload.
   - Audit record creation, update, delete, capture, release setting update, backup, and unlock-facing actions without secrets.

7. **Release preview cleanup**
   - Keep release as local preview only.
   - No nominee execution, key-holder verification, alert delivery, or server timer.

8. **UI polish**
   - Polish only after crypto, persistence, unlock, recovery, backup, and audit are stable.

## Exact File / Module Plan

### Created

- `apps/web/src/lib/stage1Crypto.js`
  - Stage 1 vault container creation.
  - Passphrase key envelope.
  - Recovery key envelope.
  - Vault decrypt/update.
  - Backup shape validation.

- `apps/web/src/lib/stage1Crypto.test.js`
  - Verifies passphrase unlock, wrong phrase failure, recovery unlock, encrypted update, backup validation, and recovery key normalization.

- `apps/web/src/lib/stage1Store.js`
  - Local storage boundary.
  - Stage 1 storage key.
  - Validated backup restore.
  - Test memory storage.

- `apps/web/src/lib/stage1Store.test.js`
  - Verifies save/load, malformed state handling, valid restore, invalid restore refusal.

- `docs/os-one-stage1-execution-plan.md`
  - This execution plan.

### Modified

- `apps/web/src/main.jsx`
  - Uses Stage 1 vault containers.
  - Requires recovery key confirmation on vault creation.
  - Unlocks with vault phrase or recovery key.
  - Saves encrypted vault updates through Stage 1 crypto.
  - Restores only validated Stage 1 backups.

- `apps/web/package.json`
  - Add test command for Stage 1 module tests.

## Dependency List

No new runtime dependency is required for Stage 1.

Existing dependencies used:

- React
- Vite
- Tailwind
- WebCrypto through `globalThis.crypto.subtle`
- Tesseract.js for local OCR prototype capture

Deferred dependencies:

- Argon2id WASM or native binding for production KDF.
- Native secure storage for desktop.
- Backend release services.
- Cloud sync services.
- Model-backed capture.

## Data Flows

### Vault Creation

1. User creates vault phrase.
2. User generates and confirms recovery key.
3. Client generates random AES-GCM vault key.
4. Client derives passphrase wrapping key using WebCrypto PBKDF2.
5. Client wraps vault key with passphrase wrapping key.
6. Client derives recovery wrapping key from recovery key.
7. Client wraps vault key with recovery wrapping key.
8. Client encrypts vault payload with vault key.
9. Client stores Stage 1 encrypted vault container locally.

### Unlock

1. User enters vault phrase or recovery key.
2. Client derives the matching wrapping key.
3. Client unwraps vault key.
4. Client decrypts encrypted vault payload.
5. Decrypted vault and vault key stay only in session memory.

### Recovery Key

1. Recovery key is generated on device.
2. User must confirm it before vault creation.
3. Recovery key plaintext is never stored.
4. Recovery key unlocks by unwrapping the same vault key.

### Backup

1. App downloads encrypted Stage 1 vault container.
2. Backup includes encrypted vault and encrypted key envelopes.
3. Backup does not include vault phrase or recovery key plaintext.

### Restore

1. User imports JSON backup.
2. App validates Stage 1 shape and trust-boundary declaration.
3. Valid backup replaces local encrypted vault state.
4. User must unlock with vault phrase or recovery key.

## Top Technical Risks

1. **PBKDF2 is beta-grade for this product.**
   - Acceptable for Stage 1 prototype.
   - Production must move to Argon2id.

2. **Browser local storage is not durable enough for real life records.**
   - Stage 1 is single-device beta only.
   - Desktop beta needs native secure storage and filesystem backup.

3. **Recovery key UX can create false confidence.**
   - Copy must say OS-One cannot recreate it.
   - Confirmation is required before vault creation.

4. **Restore can damage trust if it overwrites silently.**
   - Stage 1 validates before replacing.
   - Later restore should preview backup contents after decrypt verification.

5. **Release preview can look real.**
   - UI must keep saying no nominee execution, no alerts, no timer, no backend release exists yet.

## Recommended Implementation Order

1. Vault crypto foundation.
2. Local persistence.
3. Unlock / lock session flow.
4. Recovery key flow.
5. Backup / restore.
6. Audit trail.
7. Release preview cleanup.
8. UI polish.

## Current Stage 1 Status

- Vault crypto foundation: implemented for beta with tested passphrase and recovery key envelopes.
- Local persistence: implemented with validated Stage 1 storage and restore boundaries.
- Unlock / lock session flow: implemented with manual lock, inactivity lock decision logic, and visibility/background lock trigger.
- Recovery key flow: implemented with generated user-held key and confirmation.
- Backup / restore: implemented with decrypt-before-replace preview showing record, attachment, audit, version, and date metadata.
- Audit trail: implemented inside encrypted vault payload, with safe pending metadata for failed unlock and locked restore attempts.
- Attachment hardening: implemented with size/type validation, duplicate-name normalization, delete/replace controls, and no object URL preview persistence.
- Release preview cleanup: labelled as local simulation only.
- UI polish: intentionally deferred beyond trust-critical surfaces.

## Stage 1 Slice 2 Verification

- `npm test -w @os-one/web`: 21 tests passing.
- `npm run check -w @os-one/web`: Vite build passing.
- Browser smoke path covered:
  - Create sample vault.
  - Reveal and hide sensitive value.
  - Add and delete attachment.
  - Export encrypted backup.
  - Manual lock clears visible sensitive state.
  - Failed unlock is queued and sealed into audit on next successful unlock.
  - Restore preview requires decrypt verification before local replacement.
  - Restore confirmation is audited.

## Stage 1 Final Trust-Hardening Pass

- Auto-lock UX: current policy is visible in the Life Map security panel, timeout choices are configurable, manual/inactivity/background lock reasons are distinct, and the lock reason appears once on the locked entry screen.
- Restore decision quality: restore uses decrypt-before-replace preview, compares incoming backup age against the current local vault where possible, shows current vs incoming counts, and requires typing `REPLACE` before local replacement.
- Attachment preview hardening: attachment type/size/name behavior is tested, duplicate names are normalized, preview cleanup revokes object URLs, and attachment previews collapse on lock/restore because decrypted vault UI unmounts.
- Audit trail UX: audit is grouped into Session security, Records and attachments, Backup and restore, and Vault activity, with actor/action/time/reason and no secret values.

Final hardening verification:

- `npm test -w @os-one/web`: 28 tests passing.
- `npm run check -w @os-one/web`: Vite build passing.
- Browser retest covered:
  - Visible auto-lock policy and timeout persistence.
  - Manual lock reason visible after relock.
  - No stale sensitive dossier text after lock.
  - Restore preview comparison and dry-run replacement summary.
  - Typed restore confirmation gate.
  - Grouped human-readable audit with restore confirmation.
