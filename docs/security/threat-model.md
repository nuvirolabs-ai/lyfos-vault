# Lyfos Vault — Threat Model

_Document owner: founder. Reviewed at every release that touches crypto, auth,
release engine, or billing. Last review: 2026-05-28._

## Assets (what we protect)

| Asset                          | Sensitivity | Where it lives                                |
|--------------------------------|-------------|-----------------------------------------------|
| Vault plaintext                | Critical    | Client memory only (web/iOS/Android)          |
| Vault key (32 bytes raw)       | Critical    | Client memory only; never sent to server      |
| User passphrase                | Critical    | Client memory only; never sent to server      |
| Encrypted vault blob           | High        | `vault_blobs.encrypted_record` (Supabase)     |
| BIP39 recovery phrase          | Critical    | Only the user has it; we never store it       |
| Key holder secret keys         | Critical    | Derived from holder's passphrase, client only |
| Sealed key shares (5)          | High        | `key_shares.ciphertext` (Supabase)            |
| Death certificate PDFs         | Medium      | `death_certificates/` storage bucket          |
| Released emergency bundles     | High        | Generated client-side on nominee device       |
| Audit log                      | Medium      | `audit_log` (Supabase, append-only RLS)       |
| Billing PII (GSTIN, address)   | Medium      | `billing_profile` (Supabase)                  |
| Invoice PDFs                   | Medium      | `invoices/` storage bucket                    |
| Push tokens                    | Low         | `push_tokens` (Supabase)                      |

## Adversaries (who we defend against)

| Adversary                                  | Capabilities                                                                                            | Realistic threat? |
|--------------------------------------------|---------------------------------------------------------------------------------------------------------|-------------------|
| **Curious Lyfos employee** (incl. founder) | Full DB read, full storage read, function logs, service-role key                                        | YES — must not see plaintext or vault key |
| **Compromised Supabase admin / insider**   | Same as above + can change RPCs / RLS                                                                   | YES — must not be able to forge a release |
| **External attacker with stolen DB dump**  | Full DB read, no service role                                                                           | YES — must learn nothing useful |
| **Network attacker (TLS not yet up)**      | Read + tamper with HTTP                                                                                 | NO — TLS is mandatory; HSTS preload pending |
| **Compromised user device**                | Full memory read, full storage read, root                                                               | OUT OF SCOPE — we cannot defend against this; document so the user knows |
| **Compromised key holder**                 | Can release their share unilaterally                                                                    | YES — that's why we require 3-of-5 and a 14-day owner-protection hold |
| **Compromised nominee**                    | Has the claim flow code, can present a fake death certificate                                           | YES — defended by admin review + multi-channel owner alerts + 14-day hold + abort |
| **Lost recovery phrase + lost passphrase** | Can't decrypt                                                                                           | OUT OF SCOPE — this is by design; we document it |
| **Subpoena / state actor (lawful)**        | Can compel the database; cannot compel us to produce plaintext we don't have                            | YES — zero-knowledge architecture is the defense |
| **Subpoena / state actor (unlawful)**      | Can compel us to weaken crypto in a future release                                                      | Documented in transparency report (Phase 7) |

## Trust boundaries

```
+--------------------------------------------------------------+
|  Client device (web/iOS/Android)                              |
|                                                                |
|   passphrase → Argon2id → vault key → AES-GCM(plaintext)       |
|                                                                |
|   Holder passphrase → derive Curve25519 keypair                |
|   Owner: split vault key (Shamir 3-of-5) → seal each share     |
|                                                                |
+-----------------------------+---------------------------------+
                              | TLS 1.3 only
                              v
+-----------------------------+---------------------------------+
|  Supabase (Mumbai region)                                     |
|                                                                |
|   vault_blobs (encrypted JSONB)                                |
|   key_shares (sealed ciphertext + ephemeral pub)               |
|   release_requests (state machine, ready_at, hold_until)       |
|   release_alerts (channel × day)                               |
|                                                                |
|   RLS: owner-only read on vault_blobs                          |
|   RLS: holder-only read on their key_share row                 |
|   RPCs SECURITY DEFINER for state transitions                  |
|                                                                |
+-----------------------------+---------------------------------+
                              | webhooks (HMAC-verified)
                              v
+-----------------------------+---------------------------------+
|  Razorpay / Resend / MSG91 / Meta / Expo Push                 |
|                                                                |
|   Razorpay: card data tokenised — Lyfos never sees PAN         |
|   Resend / MSG91 / Meta: see owner email/phone for alerts      |
|   Expo Push: opaque token, no PII                              |
|                                                                |
+--------------------------------------------------------------+
```

## STRIDE per critical flow

### Vault unlock

| Threat       | Mitigation                                                                                       |
|--------------|--------------------------------------------------------------------------------------------------|
| Spoofing     | Email confirmation on signup; magic link uses single-use PKCE; passkeys planned Phase 7         |
| Tampering    | Encrypted blob is AEAD (AES-GCM); any modification breaks decryption                            |
| Repudiation  | Server-side audit log on every unlock/sync (no payload, just metadata)                          |
| Information disclosure | KDF run client-side; passphrase never leaves device; key is non-extractable WebCrypto where supported |
| DoS          | Argon2id at 64 MiB / 3 iter is slow; rate-limit unlock attempts in app                          |
| EoP          | Even the founder cannot decrypt; auditable via threat-model + open-source crypto layer          |

### Release request (nominee → vault)

| Threat       | Mitigation                                                                                                          |
|--------------|---------------------------------------------------------------------------------------------------------------------|
| Spoofing     | Nominee must produce the unique claim token (URL); admin reviews death certificate                                  |
| Tampering    | Release state transitions only via SECURITY DEFINER RPCs; client cannot set states directly                          |
| Repudiation  | Every state transition appends to `audit_log`                                                                       |
| Information disclosure | Vault stays sealed until 3 shares released + 14-day hold + owner did not abort                              |
| DoS          | Admin queue + per-IP rate limit on `create_release_request`                                                         |
| EoP          | Even an admin cannot bypass the 14-day hold; trigger enforces `ready_at + 14d <= now()`                            |

### Billing

| Threat       | Mitigation                                                                                                          |
|--------------|---------------------------------------------------------------------------------------------------------------------|
| Spoofing     | Razorpay webhook HMAC verified with `RAZORPAY_WEBHOOK_SECRET`                                                       |
| Tampering    | Subscription state only updated via verified webhook; `billing_events` unique `(provider, provider_event_id)`        |
| Repudiation  | Sequential invoice numbers via `allocate_invoice_number` RPC; PDFs immutable in storage                              |
| Information disclosure | PAN/card data never enter our system; Razorpay holds them                                                  |
| DoS          | Edge function timeout + idempotency means retries are cheap                                                          |
| EoP          | Free-tier defense in depth: client cap + `assert_paid_for_release()` trigger on `key_shares` insert                  |

## Cryptographic agility

We use Argon2id (today) and PBKDF2-SHA256 (legacy beta vaults). Envelope
records the KDF name + params so we can introduce Argon2id-2024-params or a
new KDF without breaking older vaults. Same approach for AEAD (AES-GCM today;
XChaCha20-Poly1305 is the planned next step). Crypto upgrades happen
auto-on-unlock — see `stage1Crypto.upgradeEnvelopeKdf`.

## Known limitations (documented to the user)

1. **Compromised device cannot be defended.** A user whose phone is rooted or
   whose laptop is keylogged has already lost. We say so in the privacy page.
2. **Lost recovery phrase + lost passphrase = lost vault.** By design.
3. **The 14-day hold is wall-clock time.** A user who is in a coma for less
   than 14 days cannot abort. The mitigation is the 3-of-5 social trust layer
   and the multi-channel alerts (a friend can abort on their behalf if they
   know the owner's credentials).
4. **Key holder collusion (3 of 5)** can release without consent. This is the
   intended trust model — pick holders accordingly. Documented in onboarding.

## Open issues

- Passkey / WebAuthn unlock (Phase 7).
- Verifiable transparency log for release events (Phase 7).
- Reproducible builds for the mobile apps (Phase 7).
