# OS-One Vault Technical Spec

Date: 2026-05-03

## Opinionated V1 Path

OS-One V1 uses a zero-knowledge client-encrypted vault with account authentication, device trust, encrypted backups, recovery key support, and a separate emergency package model.

The backend coordinates identity, sync metadata, encrypted blob storage, release workflow state, owner alerts, and audit logs. It must not receive vault phrases, vault master keys, record plaintext, attachment plaintext, or normal vault decryptable key material.

Normal account login never decrypts the vault.

## Client Architecture

### Runtime Targets

- Web beta: React + WebCrypto + IndexedDB.
- Desktop serious beta: Tauri shell with shared React UI, native secure storage, signed updates, and file-system backup support.
- Mobile later: native iOS/Android for hardware-backed secure storage and capture quality.

### Client Modules

#### `account-client`

Responsibilities:

- Account session.
- Passkey or password authentication with backend.
- MFA challenge handling.
- Device registration and revocation.

Must not:

- Store vault phrase.
- Decrypt vault contents.
- Send vault keys to backend.

#### `crypto-core`

Responsibilities:

- Generate vault master key.
- Derive passphrase KEK.
- Wrap and unwrap vault key locally.
- Encrypt/decrypt records.
- Encrypt/decrypt attachments.
- Encrypt/decrypt backups.
- Generate recovery key material.

Required primitives:

- Argon2id for passphrase KDF in production.
- PBKDF2 may remain only for prototype compatibility until replaced.
- AES-256-GCM or XChaCha20-Poly1305 for authenticated encryption.
- HKDF for subkey derivation.
- Random 96-bit nonce for AES-GCM, never reused with the same key.
- Secure random bytes from platform crypto APIs.

#### `vault-store`

Responsibilities:

- Maintain decrypted in-memory vault session after unlock.
- Persist encrypted local cache to IndexedDB or native secure local storage.
- Sync encrypted envelopes to backend.
- Track dirty records and sync conflicts.

Must not:

- Persist decrypted records.
- Store sensitive values in logs.

#### `capture-engine`

Responsibilities:

- Convert paste, OCR text, and uploaded document text into candidate record drafts.
- Show confidence, evidence, missing fields, and source references.
- Require confirmation before vault write.

Beta behavior:

- Local OCR and heuristic parsing are acceptable if labelled clearly.

Production behavior:

- Use model-backed extraction on client when possible.
- If server-side extraction is used, send only user-approved decrypted source to a privacy-scoped processing service with explicit consent, short retention, no training, and clear UI labeling. This weakens pure local privacy and must be opt-in.

#### `release-client`

Responsibilities:

- Owner release setup.
- Nominee request UI.
- Key-holder confirmation UI.
- Owner cancellation UI.
- Emergency session UI.

Must show:

- Whether flow is simulated or production-backed.
- Which records are emergency-enabled.
- What the nominee can access.

#### `backup-client`

Responsibilities:

- Export encrypted backup.
- Import encrypted backup.
- Verify backup manifest before restore.
- Support local file save and user-selected external drive folder.

Must not:

- Export plaintext backups.
- Suggest cloud drive sync is safe unless backup is encrypted before upload.

#### `audit-client`

Responsibilities:

- Show owner-visible history for unlocks, reveals, exports, deletes, release setup changes, release requests, owner cancels, emergency package access, device additions, and backup imports.
- Keep sensitive values out of event details.

## Backend Services

### `auth-service`

Purpose:

- User account registration and login.
- Passkeys/password auth.
- MFA.
- Session issuance.
- Device enrollment authorization.

Cannot access:

- Vault phrase.
- Vault master key.
- Decrypted records.

### `vault-sync-service`

Purpose:

- Store encrypted vault envelopes.
- Store encrypted attachment blobs.
- Manage revisions and conflict metadata.

Can read:

- Owner ID.
- Record IDs.
- Category.
- Revision number.
- Encrypted payload size.
- Updated timestamps.
- Emergency eligibility metadata if stored outside encrypted payload.

Cannot read:

- Record title if product chooses encrypted titles.
- Sensitive fields.
- Notes.
- Attachment contents.

V1 choice:

- Keep record title encrypted inside payload.
- Store category, release visibility, review state, and item type as plaintext metadata because they power navigation and release setup. This is a privacy tradeoff and must be disclosed internally.

### `attachment-service`

Purpose:

- Store encrypted attachment objects.
- Return signed upload/download URLs.
- Verify size and content-type limits.

Cannot read:

- Attachment plaintext.
- OCR content.
- Sensitive metadata stored inside encrypted attachment manifest.

### `backup-service`

Purpose:

- Optional encrypted backup storage for users who opt into OS-One-hosted backup.
- Store backup manifests and encrypted backup blobs.

Cannot read:

- Backup plaintext.
- Vault key.

### `release-service`

Purpose:

- Store nominee/key-holder setup metadata.
- Coordinate release requests.
- Verify nominee identity.
- Verify key-holder approvals.
- Enforce threshold.
- Start and enforce 14-day hold.
- Send owner alerts.
- Handle owner cancellation.
- Create emergency sessions.

Can access:

- Emergency package encrypted payloads and release envelope metadata.
- Release workflow state.

Cannot access:

- Normal vault contents.
- Non-emergency-enabled records.
- Owner vault phrase.

### `notification-service`

Purpose:

- Send owner alerts, key-holder invites, nominee updates, cancellation notices, and security notices.

Must not include:

- Secret values.
- Record contents.
- Attachment contents.

### `audit-service`

Purpose:

- Append-only event stream for security-sensitive actions.
- Owner-visible audit timeline.
- Internal abuse detection.

Must not log:

- Vault phrase.
- Decrypted sensitive values.
- Full document OCR text.
- Recovery key plaintext.

## Encryption Flow

### Vault Creation

1. Client creates account session.
2. Client asks user to create vault phrase.
3. Client generates random `vault_master_key`.
4. Client derives `passphrase_kek` from vault phrase using Argon2id.
5. Client wraps `vault_master_key` with `passphrase_kek`.
6. Client stores wrapped vault key locally and syncs encrypted key envelope to backend.
7. Client generates recovery key if user accepts recovery setup.
8. Client wraps `vault_master_key` with recovery key material and stores encrypted recovery envelope.

Backend receives:

- Account ID.
- Crypto parameters.
- Wrapped key envelopes.
- Device metadata.

Backend never receives:

- Vault phrase.
- Passphrase KEK.
- Vault master key plaintext.

### Record Save

1. Client validates structured record.
2. Client generates record ID and revision.
3. Client encrypts record payload with key derived from `vault_master_key`.
4. Client uploads encrypted envelope and plaintext metadata allowed by the data model.
5. Backend stores envelope and revision.
6. Audit event records `record.created` or `record.updated` without sensitive values.

### Attachment Save

1. Client reads file locally.
2. Client generates attachment key or derives attachment subkey.
3. Client encrypts file bytes locally.
4. Client uploads encrypted object to attachment storage.
5. Client stores encrypted attachment manifest in the record payload.
6. Backend stores object metadata and object locator.

## Emergency Package Flow

Emergency release must not decrypt the full vault. The owner creates a separate emergency package from selected records.

### Package Creation

1. Owner marks records as emergency-enabled.
2. Client builds emergency package payload containing only approved fields and attachments.
3. Client generates `emergency_package_key`.
4. Client encrypts package payload locally.
5. Client creates a release envelope that can be opened only after release policy completion.
6. Backend stores encrypted package and release policy metadata.

### Key Holder Role

Key holders should not hold vault contents. They hold or approve threshold material that helps authorize release.

V1 production choice:

- Use server-verified key-holder approvals plus owner-created release envelope.
- Key holders authenticate and sign approvals.
- The backend enforces threshold and hold timer.
- Emergency package key is released to nominee only after policy completion.

Security note:

- If the backend can release the emergency package key after policy completion, the backend becomes part of emergency release trust. This is acceptable only for emergency package data, not normal vault contents.
- The UI must say emergency-enabled records are prepared for release under policy. It must not say the full vault remains purely owner-only if emergency package keys are server-releasable after policy completion.

## Recovery Key Flow

### Setup

1. Client generates high-entropy recovery key displayed as grouped words or characters.
2. User confirms by re-entering selected groups.
3. Client derives `recovery_kek`.
4. Client wraps `vault_master_key`.
5. Client stores encrypted recovery envelope with backend and local backup.

### Use

1. User signs into account on a trusted or newly verified device.
2. User enters recovery key.
3. Client derives `recovery_kek`.
4. Client unwraps `vault_master_key`.
5. Client requires user to create a new vault phrase.
6. Client rotates passphrase-wrapped key envelope.
7. Audit records recovery key use.

Non-goal:

- OS-One support cannot recover vault contents without user-held recovery key.

## Backup / Restore Flow

### Export

1. User unlocks vault.
2. Client creates backup manifest:
   - version
   - created time
   - account ID
   - vault ID
   - crypto params
   - record envelope list
   - attachment object references or embedded encrypted attachments
   - checksum
3. Client encrypts backup package with backup key derived from vault phrase or recovery key.
4. Client downloads `.osonebackup`.
5. Audit records backup export.

### Restore

1. User selects backup file.
2. Client parses manifest without decrypting sensitive payloads.
3. Client verifies version, checksum, and compatible crypto params.
4. User enters vault phrase or recovery key.
5. Client decrypts a verification block.
6. UI previews restore scope.
7. User confirms import.
8. Client writes encrypted local state and syncs encrypted envelopes if account is connected.
9. Audit records backup restore.

Failure behavior:

- If decrypt verification fails, do not modify current vault state.
- If backup is newer than client supports, ask user to update app.

## Release Workflow Flow

### Owner Setup

1. Owner selects Main Nominee.
2. Owner adds up to five key holders.
3. Owner sets threshold, default three.
4. Owner confirms 14-day hold and twice-daily alerts.
5. Owner previews emergency package contents.
6. Client creates emergency package.
7. Backend stores release policy and encrypted package.

### Nominee Request

1. Nominee logs in.
2. Nominee passes identity verification.
3. Nominee starts request and states reason.
4. Backend creates `release_request`.
5. Backend notifies key holders and owner.
6. Audit records request.

### Key Holder Approval

1. Key holder logs in.
2. Key holder reviews owner name, nominee name, request reason, and warning.
3. Key holder approves or declines.
4. Backend stores signed approval event.
5. When threshold is met, backend starts hold timer.

### Owner Alerts And Cancellation

1. Notification job sends alerts twice daily.
2. Owner can cancel from authenticated session.
3. Cancellation freezes release request.
4. Nominee and key holders receive cancellation notice.
5. Audit records cancellation.

### Emergency Session

1. After hold expires with no cancellation, backend marks request approved.
2. Backend creates time-limited emergency session.
3. Nominee accesses emergency package only.
4. Every package view, reveal, download, and export is audited.

## Device Trust Flow

### New Device

1. User signs into account.
2. Backend checks risk signals.
3. User unlocks vault with phrase or recovery key.
4. Client generates device key pair.
5. Client registers public device key.
6. Local platform secure storage stores wrapped vault unlock material if user allows.
7. Audit records device addition.

### Device Revocation

1. User removes device from trusted device list.
2. Backend stops issuing sync sessions for that device.
3. Future sync and release actions from that device fail.
4. User is warned that already exported backups cannot be recalled.

## Audit Logging Flow

### Client Events

Client creates local audit entries for:

- unlock success
- unlock failure
- reveal sensitive value
- backup export
- backup restore
- record create/update/delete
- attachment add/delete
- emergency visibility change

### Server Events

Server creates append-only events for:

- account login
- device registration
- device revocation
- sync write
- release request
- key-holder approval
- owner alert sent
- owner cancellation
- emergency session created
- emergency package view/export

Event rule:

- Log actor, action, entity ID, timestamp, result, IP/device risk metadata where appropriate.
- Never log secrets or decrypted payloads.

## Exact Trust Boundaries

### Backend Can Know

- Account identity.
- Device metadata.
- Vault ID.
- Record IDs.
- Record category and type, if product chooses plaintext metadata.
- Record release visibility state.
- Encrypted payload sizes.
- Sync revisions.
- Nominee and key-holder identities.
- Release request state.
- Owner alert delivery status.
- Audit event metadata.

### Backend Cannot Know

- Vault phrase.
- Vault master key.
- Normal record plaintext.
- Sensitive fields.
- Family notes if stored inside encrypted payload.
- Attachment plaintext.
- Backup plaintext.
- Recovery key plaintext.

### Nominee Can Know Before Release

- Owner identity.
- Their nominee role.
- Key-holder contact visibility only if owner allows it.
- Request status.

### Nominee Cannot Know Before Release

- Emergency package contents.
- Normal vault contents.
- Private-only record list.
- Sensitive values.

### Key Holder Can Know

- Owner identity.
- Nominee identity.
- That a release request exists.
- What action they are being asked to approve.

### Key Holder Cannot Know

- Vault contents.
- Emergency package contents unless owner separately shared them.
- Other private records.

## Explicit Non-Goals

- No server-side decryption of normal vault contents.
- No account password reset that decrypts old vaults.
- No hidden OS-One recovery escrow.
- No unencrypted cloud drive sync.
- No production emergency release without real backend enforcement, alerts, audit, and abuse controls.
- No claim that visual masking after unlock is cryptographic protection.
- No model extraction that silently sends private documents to third-party services.
- No analytics on sensitive text, document content, passwords, PINs, or card numbers.
