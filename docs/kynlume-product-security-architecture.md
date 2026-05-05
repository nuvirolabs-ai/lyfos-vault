# Kynlume Product + Security Architecture

Date: 2026-04-29

## Working Name

Recommended name: **Kynlume**

Pronunciation: **KIN-loom**

Meaning: a coined word from **kin** and **lumen**. It suggests family, guidance, and protected clarity without sounding like a generic vault, password manager, or legal-tech product.

Name-search note: initial web searches found obvious conflicts for Aurenza, Nuvyra, Veylume, and Nexorae. Searches for "Kynlume" did not surface an obvious exact-match product or company in the first pass, but this is not a legal clearance. Before launch, run trademark, domain, App Store, Play Store, GitHub, social handle, and international company-registry checks.

## Product Thesis

Kynlume is a private life-access vault for the information a family may need during an emergency, incapacity, or death.

It is not positioned as another password manager. Password managers help users log in. Kynlume helps families avoid chaos without giving anyone premature access.

Core promise:

> Your important life access stays private while you are alive, and becomes reachable only when trusted people coordinate under your rules.

## Differentiation

Most vaults are built around storage. Kynlume is built around **controlled release**.

Key differences:

- Stores life-critical information beyond passwords: PINs, bank details, card details, IDs, credentials, insurance, email access, mobile PINs, and important documents.
- Uses a Main Nominee plus independent key holders, so no single person can open the vault.
- Adds a 14-day waiting period with twice-daily owner alerts before emergency release.
- Keeps product surfaces simple: Add, Vault, Protect, Review.
- Treats security, recovery, and nominee access as product design, not settings-page clutter.

## MVP Scope

Build only the slices needed to prove trust, usefulness, and simplicity.

### User-Facing Surfaces

1. **Add**
   - Add a password, PIN, bank detail, document, ID, or insurance record.
   - Upload a screenshot or PDF.
   - Paste messy notes.
   - Confirm extracted fields before saving.

2. **Vault**
   - Calm grouped records.
   - Search.
   - Reveal sensitive fields only after vault unlock.
   - No dashboard metrics as the main experience.

3. **Protect**
   - Set Main Nominee.
   - Add up to 5 key holders.
   - Explain the release rule visually.
   - Show who is active, pending, or missing setup.

4. **Review**
   - Gentle prompts: still correct, missing details, expired document, nominee not verified.
   - No long forms unless the user opens an item.

### MVP Item Types

- Password / login
- Bank account
- Card
- PIN / code
- Identity document
- Insurance policy
- Important document
- Emergency instruction

## Platform Strategy

### Phase 1: Web App

Purpose: fastest iteration and easiest private beta.

Recommended stack:

- Next.js or React app
- TypeScript
- Postgres for account metadata
- Encrypted object storage for vault blobs
- WebCrypto for client-side cryptography
- Passkeys as primary authentication

### Phase 2: Desktop App for Mac and Windows

Purpose: more trust, local-first feel, secure local cache, native file handling.

Recommended stack:

- Tauri
- Rust shell for native secure storage, file access, updater, and OS integration
- Shared TypeScript UI from web app where practical

Reason: Tauri has a smaller footprint than Electron and gives stronger native control. For a high-security vault, avoid shipping a heavy browser shell unless there is a strong reason.

### Phase 3: Mobile

Purpose: everyday capture and emergency access.

Recommended stack:

- iOS native Swift for best Apple-level detail and Keychain/Secure Enclave integration
- Android native Kotlin for hardware-backed keystore integration

React Native is acceptable only if speed matters more than platform polish.

## Security Principles

Kynlume should never claim to be hack-proof. The credible claim is:

> Zero-knowledge encryption, hardware-backed protection where available, independent audits, and a release protocol designed to prevent single-person abuse.

Use these standards as build targets:

- OWASP ASVS for web application and API verification.
- OWASP MASVS for mobile app verification.
- NIST SP 800-63B for authentication and authenticator lifecycle.
- Platform security capabilities such as Apple Keychain, Secure Enclave, Windows Hello, and Android Keystore.

## Cryptographic Architecture

### Zero-Knowledge Vault

- Encrypt vault data on the client before upload.
- Server stores encrypted blobs only.
- Server never receives the vault master key.
- Backend cannot read user secrets, documents, passwords, PINs, or card details.
- Password reset cannot decrypt old vault content.

### Key Hierarchy

Suggested model:

- User vault master key: random 256-bit key generated on device.
- Item keys: per-item random keys used to encrypt individual records.
- Vault key wraps item keys.
- Device keys protect local unlock on trusted devices.
- Recovery key protects account recovery without server access to plaintext.

### Encryption

Use audited, standard primitives only:

- AES-256-GCM or XChaCha20-Poly1305 for authenticated encryption.
- Argon2id for password-based key derivation if password fallback is used.
- HKDF for key derivation.
- Ed25519 or P-256 for signing device/release events, depending on platform support.

Never build custom cryptography.

## Authentication Model

Primary:

- Passkeys.
- Device approval.
- Biometric unlock through platform secure storage.

Fallback:

- Strong account password.
- Recovery key.
- Verified trusted device.

Avoid using email as a security factor by itself. Email can be used for notification, not as the sole proof of identity.

## Emergency Release Protocol

### Setup

- Owner chooses one Main Nominee.
- Owner can add up to five independent key holders.
- Each key holder receives and verifies their key through their own account or secure invite.
- Main Nominee can see who the key holders are, so coordination is possible in a real emergency.

### Release Attempt

1. Main Nominee signs in with their own password/passkey.
2. Kynlume asks for 3 of 5 independent keys.
3. Once threshold is met, the vault does not open immediately.
4. A 14-day waiting period begins.
5. Owner receives email alerts twice daily during the waiting period.
6. If the owner cancels, release stops and key holders are notified.
7. If no cancellation occurs after 14 days, the Emergency Vault opens to the Main Nominee.

### Important Product Rule

Emergency release should expose only owner-approved emergency items, not the full private vault by default.

## Threat Model Summary

Primary risks:

- Server database breach.
- Compromised user password.
- Compromised nominee account.
- Malicious nominee attempting early access.
- Phishing.
- Stolen device.
- Insider threat.
- Bulk export abuse.
- Weak recovery flow.

Core mitigations:

- Client-side encryption.
- Passkeys and device-bound sessions.
- Hardware-backed key storage where possible.
- No plaintext secrets on the server.
- Separate item keys.
- Emergency threshold release.
- 14-day delay.
- Twice-daily owner alerts.
- Audit logs for sensitive actions.
- No silent bulk export.
- External security audit before real-data launch.

## Privacy and Compliance Posture

Design for:

- Data minimization.
- Explicit consent for every stored item.
- Clear export and delete controls.
- Regional data controls later if needed.
- Auditability without logging sensitive values.

Kynlume should not store plaintext secrets in analytics, logs, support tools, or crash reports.

## UX Principles

Apple-level detailing means the product should feel obvious, not feature-rich.

Principles:

- One primary action per screen.
- Progressive disclosure.
- Calm language.
- No fear-based copy inside the app.
- Security explained visually.
- Empty states should teach through action, not paragraphs.
- Sensitive values are masked by default.
- Reveal actions are intentional and logged.
- Forms are short and contextual.

## MVP Build Plan

### Milestone 1: Clickable Product Prototype

Goal: validate the user experience before real secrets exist.

Build:

- Onboarding
- Add item
- Confirm item
- Vault item detail
- Protect setup
- Emergency release simulation

No real encryption yet in prototype data.

### Milestone 2: Security Architecture Spike

Goal: validate crypto and recovery before product expansion.

Build:

- Client-side encryption proof of concept.
- Vault key generation.
- Item encryption.
- Device unlock.
- Recovery key flow.
- Encrypted blob sync.

### Milestone 3: Private Web MVP

Goal: usable with low-risk test data.

Build:

- Account auth.
- Vault CRUD.
- Encrypted storage.
- Local unlock.
- Manual item types.
- Basic document upload.
- Nominee and key-holder setup.

### Milestone 4: Desktop App

Goal: native trust and local-first capture.

Build:

- Tauri wrapper.
- Native secure storage.
- Auto-update.
- Local encrypted cache.
- Secure file import.

### Milestone 5: Security Review

Goal: earn trust before sensitive beta.

Do:

- Threat model review.
- OWASP ASVS/MASVS gap analysis.
- Independent penetration test.
- Cryptography review.
- Secure development process.

## What Not To Build First

- Full family collaboration.
- Financial account integrations.
- AI-heavy automation.
- Public nominee marketplace.
- Enterprise admin panels.
- Complex dashboards.
- Legal document generation.
- Automated bank scraping.

These increase risk and dilute the thesis.

## First Engineering Decision

Build the prototype as a web app first, but design the architecture so it can become a Tauri desktop app without rewriting the product.

Recommended first repo structure:

```text
apps/
  web/
  desktop/
packages/
  ui/
  crypto/
  vault-model/
  release-protocol/
docs/
  threat-model.md
  security-architecture.md
```

## Open Decisions

- Whether Kynlume replaces OS-One as the product name, or OS-One remains the company/platform name and Kynlume becomes the app name.
- Whether emergency release opens only documents/instructions or also passwords by default.
- Whether key holders need Kynlume accounts or can hold offline recovery shares.
- Whether desktop v1 should be local-first or cloud-first with encrypted sync.
- Whether to pursue SOC 2 later; not needed for prototype, useful for trust once real users store sensitive data.

