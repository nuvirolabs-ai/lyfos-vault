# Circle of Trust Recovery Design

**Date:** 2026-08-02
**Status:** Approved design
**Product:** OS-One / Lyfos Vault web prototype

## Purpose

Build one reliable Circle of Trust ceremony from owner invitation through nominee recovery. The flow must use canonical links, resume after account activation, expose real email-delivery state, let the owner choose primary and backup nominees while inviting, and require the selected recipient plus two other nominees to recover the entire vault read-only.

This is a zero-knowledge recovery flow. The server coordinates identity, evidence, approvals, timing, and encrypted payloads, but must never receive enough plaintext key material to decrypt a vault.

## Product decisions

- A circle contains exactly five trusted nominees. Every nominee is also a key holder.
- Exactly one nominee is the primary recipient and exactly one is the backup recipient.
- The owner chooses each role in the inline invite form. No separate role-management dashboard is added.
- Normal recovery requires the primary recipient's private recovery key plus shares released by two other nominees.
- Backup recovery requires the approved backup recipient's private recovery key plus shares released by two other nominees.
- A recipient's own supporting share cannot count toward the two-share threshold.
- The recovered vault contains the owner's entire vault and is permanently read-only.
- The recipient signs in as themself. Recovery never creates an owner session and never impersonates the owner.
- Release retains evidence review, supporting-nominee approval, server-timed owner-protection hold, alerts, and owner abort.
- The recovery page contains both fixed Lyfos instructions and an owner-written personal note.
- Implementation and verification remain local until the owner separately authorizes staging or production changes.

## Current-system findings

The existing repository has working cryptographic primitives and passing unit tests, but its trust flow is incomplete:

- Owner-visible invite and claim links are built from `window.location.origin`, so local use produces localhost links.
- Auth confirmation always returns to the app root and does not preserve `/invite/<token>` or `/claim/<token>`.
- Invite mail and Supabase Auth mail use separate delivery paths.
- The invite function reports success when Resend accepts an API request, not when the recipient's mail server accepts the message.
- No provider message identifier or delivery webhook state is stored.
- The database has no primary or backup nominee role.
- The stored expected nominee email is displayed but is not enforced when a release request is created.
- The per-claim recipient secret is stored in `sessionStorage`, which cannot survive a multi-day recovery reliably.
- Circle finalization deletes and inserts shares in separate client operations, allowing partial finalization.
- The remote Supabase project has deployed schema but no recorded remote migration history.

The current baseline is otherwise clean: 133 web tests pass and the production web bundle builds successfully.

## Roles and authorization

### Vault owner

Creates the circle, chooses roles, writes the personal recovery note, activates or re-seals the circle while the vault is unlocked, receives alerts, and can abort an active recovery before the hold expires.

### Primary nominee

The normal recovery recipient. They authenticate with their own Lyfos account, unlock their stable recovery key locally, submit evidence, receive two supporting shares after approval, wait through the hold, and open the recovered vault read-only.

### Backup primary

The fallback recipient. They can start fallback recovery only by stating why the primary is unavailable and supplying evidence. Human review must approve the fallback recipient before support requests are sent. The primary is alerted when possible.

### Supporting nominee

Any circle member other than the selected recipient for the active recovery. A supporting nominee reviews the request, unlocks their stable recovery key locally, and approves or refuses release of their encrypted share. Two unique supporting nominees are required.

### Reviewer

Reviews death or incapacity evidence and backup-fallback evidence. A reviewer cannot decrypt the vault, create supporting shares, shorten the hold, or recover on behalf of a nominee.

## Cryptographic construction

Let `V` be the owner's 32-byte vault key.

During circle activation, the owner's browser:

1. Generates a uniformly random 32-byte recipient gate `G`.
2. Computes the masked vault key `M = V XOR G`.
3. Splits `M` into five Shamir shares with a threshold of two.
4. Seals one masked-key share to each nominee's stable recovery public key.
5. Seals `G` to the primary nominee's stable recovery public key.
6. Separately seals `G` to the backup primary's stable recovery public key.
7. Encrypts the owner's personal recovery note separately to the primary and backup public keys.
8. Sends only encrypted shares, encrypted recipient envelopes, ciphertext, role identifiers, and non-secret metadata to the server.

Because `G` is uniformly random, `M` does not reveal `V`. Two supporting shares can reconstruct `M`, but `M` is useless without a recipient envelope and the matching recipient private key. A recipient envelope reveals `G`, but `G` is useless without two valid supporting shares.

At recovery time, each supporting nominee decrypts their own stored share locally and re-encrypts it directly to the selected primary or backup's stable public key. The selected recipient later:

1. Re-derives their private recovery key from their recovery passphrase and account-bound KDF context.
2. Opens their recipient-gate envelope to obtain `G`.
3. Opens two supporting shares and combines them to obtain `M`.
4. Computes `V = M XOR G`.
5. Imports `V` as a non-extractable in-memory Web Crypto key.
6. Decrypts the vault locally.
7. Zeroes mutable plaintext key buffers on a best-effort basis.

The recipient's own Shamir share is never released into their recovery request. Database constraints and RPC authorization reject it. A primary may support an approved backup request if available, but a selected recipient can never support their own request.

The stable recovery private key is never stored server-side or in browser session storage. It is deterministically re-derived locally from the nominee's recovery passphrase and stable account context. Changing that passphrase requires the nominee to rotate their recovery public key and the owner to re-seal the circle.

## Circle setup experience

The existing five-slot Circle of Trust surface remains the only owner setup surface. Each empty slot opens a compact inline form containing:

- Name or relationship label.
- Email address.
- Optional phone number.
- Role selector: `Primary`, `Backup`, or `Trusted nominee`.

The first primary or backup choice appears as a small role pill in its row. Database constraints enforce at most one active primary and one active backup. Circle activation requires five accepted nominees, one primary, one backup, five valid public keys, and an unlocked owner vault.

Before activation, the owner can change roles without cryptographic work. After activation, changing roles, revoking a nominee, rotating a nominee key, or replacing a nominee moves the circle to `needs_reseal`. Re-sealing requires the owner to unlock the vault, generates fresh gate and share material, replaces the full encrypted key set atomically, and invalidates the previous generation.

An active recovery blocks role changes and re-sealing until the request is rejected, aborted, expired, or completed.

## Invite and account-activation flow

### Canonical URLs

All externally shared URLs come from one normalized canonical application URL:

- Web client: `VITE_APP_URL`.
- Supabase functions: `APP_URL`.

A preflight check requires both values to resolve to the same HTTPS origin for connected external sending. Externally sent links never use `window.location.origin`. Localhost and loopback origins are rejected for external mail, while explicitly labelled local test links remain available without sending.

### Invite delivery

Invite creation and email queuing occur in one server transaction. The public invite token is random, expires, is single-purpose, and is stored only as a hash. The plaintext token exists only in the URL delivered to the nominee.

The delivery record stores purpose, related invite, recipient, idempotency key, provider message ID, latest provider state, attempt count, and timestamps. Resend webhook events are signature-verified and applied idempotently. The product tracks operational states only: queued, sent, delivered, delayed, bounced, suppressed, and failed. Open and click tracking are not required.

The owner sees the real state inline in the nominee row. `Sent` means the provider accepted the request; only a delivery webhook produces `Delivered`. Bounced, suppressed, delayed, and failed states provide a specific next action. Resending reuses the invite identity while creating a new idempotent delivery attempt with a cooldown.

### Auth email delivery

Supabase Auth confirmation, magic-link, and password-reset emails route through a Supabase Send Email Hook backed by the same Resend account and verified sending domain as trust invitations. This produces one delivery vocabulary and one provider-level operational trail.

### Activation resume

Auth methods accept an explicit safe return path. Invite signup requests a confirmation redirect to the canonical `/invite/<token>` URL. Claim or recovery signup similarly preserves its exact recovery route. Only allowlisted same-origin paths can become redirects.

The invited email is prefilled and locked on the invite page. After confirmation, Supabase establishes the session and the app resumes the same invite automatically. The authenticated email must match the invite email at the database layer before a recovery public key can be registered.

The invite sequence is:

```text
/invite/<token>
→ inspect invite
→ sign in or create account
→ confirmation email when required
→ return to /invite/<token>
→ verify matching identity
→ choose and confirm recovery passphrase
→ publish recovery public key
→ accept invite
```

The page includes a resend-confirmation action with a visible cooldown and clear rate-limit feedback. An accepted or revoked token cannot be reused to attach a different account.

## Circle activation

The client computes all gate, share, and note ciphertext locally, then calls one owner-only activation RPC with the complete generation payload. The RPC validates role uniqueness, ownership, accepted identities, public-key versions, row counts, and current circle generation before replacing encrypted recovery material in one transaction.

The RPC either activates all five shares and both recipient envelopes or changes nothing. It records a non-secret audit event containing the generation number and relationship identifiers, never keys or ciphertext.

The owner sees a concise activation confirmation listing the five nominees and the primary and backup roles. Activation requires an explicit typed confirmation and an unlocked vault.

## Recovery experience

The primary does not need to preserve a secret claim URL or an open browser tab. Their authenticated account exposes a `Vaults entrusted to you` relationship list. Notifications deep-link to the authenticated recovery relationship, and RLS resolves only relationships belonging to the current user.

The recovery experience is a narrow, single-column guided page with one primary action at a time:

1. **Understand the process.** Explain evidence review, two supporting nominees, alerts, hold, abort, and read-only recovery.
2. **Read instructions.** Show the fixed Lyfos checklist, then prompt for the recovery passphrase to decrypt and show the owner's personal note locally.
3. **Submit evidence.** Choose death or incapacity, add a concise explanation, and upload accepted evidence.
4. **Human review.** Show the review state. A rejection returns a specific reason and does not notify supporting nominees.
5. **Collect support.** Request action from the four non-recipient nominees. Show approved, refused, and waiting counts without exposing private contact data across nominees.
6. **Protection hold.** Begin only after two unique valid supporting shares exist. Show the server-calculated completion time and state that the owner can abort.
7. **Open read-only vault.** Re-enter the recovery passphrase, reconstruct the vault key locally, and open the recovered vault.

Backup recovery adds an initial `Primary unavailable` step requiring a reason and evidence. Reviewer approval selects the backup as the request recipient. The primary and owner are alerted when possible, and the remaining sequence is unchanged.

## Owner-written and fixed instructions

The fixed Lyfos checklist is product copy and contains no owner data. It explains what the nominee should prepare, what each stage means, what does not happen yet, and whom to contact when blocked.

The owner writes a personal note during circle setup. The UI warns them not to place live passwords or raw keys in this note. The note is encrypted separately to the primary and backup recovery public keys and is not readable by Lyfos. Updating it after activation requires the owner to unlock the vault and replace both encrypted note envelopes.

After successful recovery, normal emergency-instruction records from the full vault appear first, followed by the rest of the vault.

## Read-only recovered vault

The recovered vault decrypts only in the selected recipient's browser memory. Its shell is visually distinct and permanently labelled `Recovered · Read only`.

It supports:

- All records and categories.
- Search.
- Intentional reveal for passwords, PINs, and other secret fields.
- Viewing and downloading attachments.
- Copying individual values after an explicit reveal.
- Automatic inactivity locking.
- Re-entry of the recovery passphrase to reopen the same authorized recovery.

It excludes:

- Add, edit, and delete operations.
- Cloud sync back into the owner's vault.
- Owner settings, devices, billing, subscription, and account controls.
- Owner authentication tokens or session impersonation.
- Silent bulk plaintext export.

The server returns the owner's encrypted vault blob to the selected recipient only when the request is `ready_to_recover`. The recipient still cannot decrypt it without their private recovery key and two supporting shares.

## State machines

### Circle

```text
draft → inviting → ready_to_seal → active
                              ↘ needs_reseal
needs_reseal → active (new atomic generation)
```

### Invite

```text
created → queued → sent → delivered → accepted
                  ↘ delayed
                  ↘ bounced
                  ↘ suppressed
                  ↘ failed
delayed/bounced/suppressed/failed → resent
any non-terminal state → revoked
created/queued/sent/delivered → expired
```

Email-delivery state and invite-acceptance state are separate fields so a manually shared link can be accepted even if email delivery fails.

### Recovery

```text
draft
→ evidence_submitted
→ under_review
→ collecting_support
→ holding
→ ready_to_recover
→ opened

terminal alternatives: rejected / aborted / expired
```

A request cannot skip states. Reviewer actions, supporting approvals, owner abort, hold advancement, and final encrypted-payload access are server RPCs with state preconditions.

## Failure handling

- Invite database failure creates neither invite nor outbox job.
- Provider rejection retains the invite and exposes canonical manual-share and resend actions.
- Delayed or bounced mail never displays as delivered.
- Duplicate send requests and duplicate webhooks do not duplicate state or email attempts.
- Activation with the wrong account is rejected without consuming the invite.
- Expired activation can be resent from the preserved invite route.
- Partial activation is impossible because the generation is replaced transactionally.
- Wrong recovery passphrases fail locally without changing server state.
- One supporting share is insufficient; a third share is unnecessary.
- The selected recipient's share is rejected as support.
- Refusal from one nominee leaves other eligible nominees available.
- Owner abort immediately closes the request and prevents encrypted vault access.
- Review rejection does not expose supporting nominee identities or contact them.
- Browser closure does not lose the stable recipient key or released encrypted shares.
- Role or key-version mismatch forces re-sealing rather than silently using stale ciphertext.

## Data-model direction

The implementation will introduce focused entities or equivalent fields for:

- Circle generation and lifecycle state.
- Nominee role: primary, backup, or trusted.
- Hashed invite tokens with expiry and consumption timestamps.
- Versioned nominee recovery public keys.
- Encrypted masked-key shares per generation.
- Encrypted primary and backup gate envelopes per generation.
- Encrypted primary and backup personal-note envelopes per generation.
- Email outbox attempts and provider delivery events.
- Recovery recipient role and key version captured at request creation.
- Supporting approvals with uniqueness and non-recipient constraints.

Existing `release_settings` claim-token behavior becomes obsolete for recovery authorization. Migration must preserve existing data safely, but no legacy claim link can authorize a new recipient after the new flow is active.

## Security boundaries

The design protects against database disclosure, email-link leakage after token hashing, provider retries, wrong-account acceptance, stale key generations, client clock manipulation, accidental partial finalization, and server-side attempts to recover the vault alone.

The intended quorum can always collaborate out of band: a selected primary or backup plus two other nominees is the authorized threshold. No server workflow can distinguish legitimate from malicious collaboration among the complete authorized quorum. Evidence review, alerts, and the hold provide procedural protection before Lyfos releases request-bound ciphertext, but they are not a cryptographic time lock.

## Verification strategy

### Unit tests

- Canonical URL normalization and rejection of localhost for external mail.
- Safe same-origin auth return paths and exact invite-route preservation.
- Invite-role uniqueness and roster summaries.
- Email state reduction, idempotency, retry cooldown, and webhook deduplication.
- Recipient-gated cryptography: primary plus two succeeds.
- Primary plus one fails.
- Two or more supporting shares without a recipient gate fail.
- Recipient's own share is excluded.
- Approved backup plus two succeeds.
- Wrong recipient key, wrong share generation, tampered ciphertext, and stale key version fail.
- Full vault decryption produces a read-only view model with every record.

### Database and RPC tests

- Role constraints and accepted-identity checks.
- Hashed-token lookup, expiry, consumption, and revocation.
- Atomic circle activation and rollback on any invalid row.
- Only the selected primary or approved backup can own a request.
- Two unique non-recipient approvals are required.
- State transitions cannot be skipped.
- Hold time uses server timestamps.
- Owner abort prevents all later access.
- RLS denies encrypted vault access before `ready_to_recover` and to every non-recipient.
- Duplicate webhook events are ignored.

### Component and browser tests

- Inline primary and backup selection.
- Invite delivery statuses and recovery actions.
- Signup confirmation returns to the exact invite route.
- Existing-account and new-account invite acceptance.
- Wrong-account recovery.
- Fixed instructions and locally decrypted owner note.
- Guided primary and backup recovery pages.
- Entire recovered vault is visible but has no mutation controls.
- Closing and reopening the browser during the hold does not lose recovery capability.

### Local ceremony

Run one complete local ceremony using an owner plus five nominee accounts, local Supabase, a local test mailbox, controlled server time, and test vault data. Exercise primary recovery, backup recovery, abort, rejection, delivery failure, activation resend, role rotation, and re-sealing. No real personal vault data is used.

Real provider delivery and DNS behavior require a later staging verification. Creating or updating staging infrastructure is outside local implementation and requires explicit owner approval.

## Migration-drift gate

The linked production Supabase project currently reports no remote migration history. Before any future schema deployment:

1. Produce a schema-only remote snapshot.
2. Compare every existing local migration against deployed tables, functions, policies, triggers, and storage rules.
3. Resolve duplicate local migration versions.
4. Record verified existing migrations in the remote ledger without reapplying their SQL.
5. Re-run schema comparison and migration status checks.
6. Review the reconciliation output before applying the new Circle of Trust migration.

Migration repair changes production metadata and therefore is not part of local implementation authorization.

## Expected file boundaries

### Web files to modify

- `apps/web/src/main.jsx`: Circle setup composition and recovered-vault route integration.
- `apps/web/src/AuthScreen.jsx`: prefilled locked email, explicit return path, confirmation resend, and activation-state UX.
- `apps/web/src/InviteAcceptScreen.jsx`: resumable invite ceremony and stable recovery-key registration.
- `apps/web/src/ClaimScreen.jsx`: replace secret claim-link authorization with authenticated relationship recovery.
- `apps/web/src/HolderReleaseScreen.jsx`: recipient-aware supporting approval and refusal.
- `apps/web/src/NomineeDownloadScreen.jsx`: replace session-secret download with stable recipient-gated read-only recovery.
- `apps/web/src/lib/auth.js`: safe canonical redirects and auth resend.
- `apps/web/src/lib/releasePlan.js`: roles, atomic activation payload, key versions, and delivery state.
- `apps/web/src/lib/releaseClaim.js`: relationship-bound recovery requests and guarded transitions.
- `apps/web/src/lib/shareCrypto.js`: recipient gate, masking, two-share split, and recovery composition.

### Web files to create

- `apps/web/src/lib/appUrls.js`: canonical external URLs and safe auth return paths.
- `apps/web/src/lib/recoveryCeremony.js`: pure recovery state and read-only view-model rules.
- Focused tests beside each new or changed library module.
- Browser-flow tests for invite activation and recovery.

### Supabase files to modify

- `supabase/functions/send-key-holder-invite/index.ts`: outbox-aware idempotent invite sending.

### Supabase files to create

- A new numbered migration for roles, generations, hashed invites, recipient envelopes, recovery authorization, outbox state, and RLS/RPC changes.
- `supabase/functions/send-auth-email/index.ts`: verified Supabase Auth Send Email Hook using Resend.
- `supabase/functions/resend-webhook/index.ts`: signature-verified idempotent delivery updates.
- SQL/RPC tests for the new migration.

### Documentation to create or update during implementation

- Environment preflight and local ceremony instructions.
- Production migration-reconciliation runbook.
- Recovery security-boundary notes.

## Out of scope

- Owner-account impersonation.
- Server escrow of vault or nominee private keys.
- Removing evidence review, alerts, owner abort, or the protection hold.
- Native mobile recovery UI parity in this slice. Mobile notifications and deep links may open the canonical web recovery flow until the web ceremony is proven.
- Enterprise dashboards, case-management queues beyond the existing narrow reviewer screen, configurable quorum sizes, multiple backups, or organization roles.
- Production deployment, migration repair, DNS changes, provider webhook registration, or live-email testing without separate approval.

## Acceptance criteria

The design is complete when local automated tests and the six-account local ceremony prove that:

- No externally sent invite or auth link can contain localhost.
- New users reliably return to the invite or recovery step that started signup.
- Delivery status distinguishes provider acceptance from mail-server delivery and failure.
- The owner selects exactly one primary and one backup within the five invite slots.
- Circle activation is atomic and zero-knowledge.
- Normal recovery requires the primary key and two other unique nominee shares.
- Backup recovery requires explicit approval, the backup key, and two other unique nominee shares.
- The recipient's own share never counts.
- Browser closure during the hold does not break recovery.
- The protection hold and owner abort cannot be bypassed by client code or clock changes.
- The selected recipient opens the complete vault under their own account in a read-only shell.
- Fixed Lyfos guidance and the owner's encrypted personal instructions are available at the correct stages.
- No owner session, plaintext vault key, nominee private key, or decrypted vault content reaches the server.
