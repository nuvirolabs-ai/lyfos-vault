# OS-One Vault Product Requirements Document

Date: 2026-05-03

## Product Purpose

OS-One Vault is a private life infrastructure app for collecting, organizing, protecting, and conditionally releasing critical personal information.

It is not a password manager. It is not a finance dashboard. It is the place a person uses to make sure their family can recover the right information during emergency, incapacity, or death without giving anyone premature access while the owner is alive.

The product thesis:

> Turn scattered private records into protected, rule-based life recovery.

## Target User

The first serious version is for individuals who already feel responsible for family continuity:

- Primary earners who manage family money, documents, passwords, policies, and property papers.
- People with dependents, parents, spouses, or nominees who would struggle if access disappeared.
- Users who care about privacy and will not trust a product that exaggerates security.
- Users who are willing to maintain important records if the product makes review feel simple, calm, and worthwhile.

The v1 user is not an enterprise admin, lawyer, executor platform, wealth manager, or compliance officer.

## Core Promise

OS-One keeps normal vault contents encrypted so OS-One cannot read them, while allowing the owner to prepare a smaller emergency package that can be released only through the owner's chosen nominee rule.

User-facing promise:

> Your private records stay yours. Your emergency records can be recovered only through the rules you set.

Engineering truth behind the promise:

- Account login proves identity to the service.
- Account login does not decrypt the vault.
- Normal vault contents are encrypted on the client before storage or sync.
- The backend stores encrypted payloads and safe metadata.
- Emergency release exposes only owner-approved emergency package data, not the full vault.
- Recovery does not rely on hidden server escrow of the vault key.

## Primary Flows

### 1. Entry and Unlock

Purpose: let the owner enter the app and understand what the vault phrase protects.

Flow:

1. User signs into account with email/passkey or app account session.
2. User enters vault phrase to unlock encrypted vault data.
3. Device derives unlock material locally.
4. Client decrypts vault locally.
5. Session auto-locks after inactivity, app backgrounding, or explicit seal action.

Success criteria:

- User understands that losing the vault phrase can make normal vault contents unrecoverable.
- User understands account access alone does not unlock records.
- Unlock feels calm, not scary.

### 2. Capture

Purpose: turn messy information into structured draft records with user confirmation.

Flow:

1. User pastes messy text or uploads a screenshot/PDF/image.
2. Client extracts candidate records using local heuristics in beta and model-backed parsing later.
3. App shows extracted fields, confidence, missing fields, and evidence snippets.
4. User confirms, edits, rejects, or splits drafts.
5. Confirmed records are encrypted locally and saved.

Success criteria:

- App never pretends uncertain extraction is certain.
- User remains in control before anything enters the vault.
- Capture reduces friction without damaging trust.

### 3. Life Map / Vault Records

Purpose: show what is protected, what is vulnerable, and what needs attention.

Flow:

1. User opens Life Map.
2. User selects Identity, Money, Access, Insurance, Property, or Instructions.
3. Workspace shows category records.
4. User opens a secure dossier, reveals masked values when needed, uploads attachments, edits, deletes, or changes emergency visibility.

Success criteria:

- The screen feels like a personal operating system, not a dashboard.
- Each record has clear owner intent: private, emergency-enabled, or needs review.
- Attachments are first-class evidence, not hidden file rows.

### 4. Emergency Release Setup

Purpose: configure who can request emergency access and what they may receive.

Flow:

1. Owner chooses one Main Nominee.
2. Owner adds up to five key holders.
3. Owner chooses a threshold, default 3 of 5.
4. Owner confirms alert rules, default 14-day hold and twice-daily owner alerts.
5. Owner previews exactly what emergency access would expose.
6. Owner activates release readiness.

Success criteria:

- Owner understands the nominee cannot open the full vault.
- Owner understands key holders cannot see vault contents.
- Owner understands production enforcement requires backend release services.
- Flow feels deliberate, not like settings.

### 5. Emergency Release Request

Purpose: allow a nominee to request access to emergency package data under owner rules.

Production flow:

1. Nominee signs in and verifies identity.
2. Nominee starts release request.
3. Key holders confirm participation.
4. Backend verifies threshold.
5. Owner receives alerts during the 14-day hold.
6. Owner can cancel.
7. If hold expires without cancellation, backend creates an emergency session.
8. Nominee receives access only to the emergency package.
9. Every step is audited without logging secrets.

Beta state:

- Frontend may simulate the flow for comprehension.
- UI must label simulation clearly.
- No beta UI may imply real third-party enforcement if backend release services are not active.

### 6. Backup and Restore

Purpose: let owner export and restore encrypted vault data without OS-One learning contents.

Flow:

1. User exports encrypted backup.
2. Backup includes encrypted vault snapshot, encrypted attachments, metadata manifest, crypto parameters, and version.
3. User stores backup locally or in their own cloud drive.
4. Restore requires the original vault phrase or recovery key.
5. Client verifies backup integrity before replacing local vault state.

Success criteria:

- User understands backup does not help if they lose all unlock material.
- Restore previews what will change before importing.
- Backup never creates hidden server escrow.

## Trust Boundaries Explained In User Language

### Account Boundary

Your OS-One account lets the service know who you are. It does not let OS-One read your vault.

### Vault Phrase Boundary

Your vault phrase unlocks private vault contents on your device. OS-One should not receive or store this phrase.

### Device Boundary

A trusted device can cache wrapped unlock material locally for faster unlock. Removing a trusted device should revoke future sync sessions but cannot erase backups already exported by the owner.

### Backend Boundary

The backend can store account records, encrypted vault blobs, encrypted attachments, release workflow state, owner alert delivery state, and audit events. The backend cannot decrypt normal vault records.

### Emergency Package Boundary

Emergency release exposes only records the owner marked emergency-enabled and packaged for release. It must not unlock or expose the full vault.

### Backup Boundary

An encrypted backup protects against device loss only if the user still has the vault phrase or recovery key. OS-One should not be able to decrypt a user backup.

### Reveal / Hide Boundary

Reveal and hide are screen privacy controls after unlock. They reduce accidental exposure but are not a second cryptographic lock once the vault is unlocked.

## In Scope For V1

### Product

- Local-first vault for personal life records.
- Client-side encryption for normal vault contents.
- Account identity that does not decrypt vault.
- Entry/unlock flow with clear passphrase dependency.
- Life Map categories: Identity, Money, Access, Insurance, Property, Instructions.
- Records with structured fields, sensitive fields, notes, emergency visibility, review state, and attachments.
- Capture flow with draft review, confidence, evidence, and missing-field states.
- Encrypted backup export and restore.
- Recovery key generation and verification.
- Emergency package setup for owner-approved records.
- Simulated nominee/key-holder release in beta with explicit labels.
- Real release backend only when release services, alerts, audit, and emergency package encryption are implemented.
- Local audit history for owner-visible sensitive actions.

### Platforms

- Web app beta.
- Packaged desktop shell after core local vault model is stable.
- Native secure storage integration for desktop before real-data launch.

## Explicitly Out Of Scope For V1

- Full estate planning or legal execution.
- Guaranteeing death or incapacity verification.
- Claiming bank-grade or hack-proof security.
- Server-side plaintext scanning of vault contents.
- Server-side password reset that decrypts old vault data.
- Hidden recovery escrow.
- Full vault emergency release by default.
- Financial analytics as a primary product surface.
- Enterprise admin controls.
- Family collaboration outside the release model.
- Automatic live syncing to Google Drive or Dropbox as plaintext files.
- Storing sensitive values in analytics, support tools, logs, or crash reports.

## Failure Cases And Product Explanation

### Forgotten Vault Phrase

Product behavior:

- Explain at setup that OS-One cannot recover normal vault contents without unlock material.
- Offer recovery key setup immediately after vault creation.
- If both phrase and recovery key are lost, explain that encrypted contents cannot be decrypted.

User language:

> OS-One can help you restore your account, but not decrypt this vault without your vault phrase or recovery key.

### Lost Device

Product behavior:

- User signs into account on a new device.
- User restores encrypted sync state or backup.
- User unlocks with vault phrase or recovery key.
- Old device can be removed from trusted device list.

### Corrupt Backup

Product behavior:

- Verify manifest, version, checksum, and decryptability before import.
- Show a safe failure message without modifying current vault.

### Nominee Abuse Attempt

Product behavior:

- Owner receives alerts during the release hold.
- Owner can cancel release.
- Request, approvals, cancellations, and access are audited.
- Production system rate-limits and flags suspicious attempts.

### Missing Key Holders

Product behavior:

- Release request stays pending until threshold is met.
- Nominee sees whom to contact only if owner allowed visibility.
- No emergency session is created until policy is satisfied.

### Owner Cannot Respond

Product behavior:

- If threshold is met and hold expires without cancellation, emergency package access can be granted.
- The app must make this consequence clear during setup.

### Capture Extracts Wrong Data

Product behavior:

- Extracted data is a draft only.
- App shows confidence, evidence, and unknown fields.
- User must confirm before save.

### Attachment Preview Fails

Product behavior:

- Record still stores attachment metadata and encrypted file.
- UI shows type, filename, size, and download/open action.
- No blank broken preview area.

## Release And Recovery UX Principles

- Never bury consequences inside settings text.
- One decision per step.
- Always preview what will be exposed before activation.
- Use calm precision instead of fear-based language.
- Label simulation honestly in beta.
- Do not imply the server can solve phrase loss.
- Do not imply emergency release opens the full vault.
- Treat review and cancellation as first-class paths.
- Show readiness as a plain state, not a gamified score.
- Use audit history to build confidence without exposing secrets.
