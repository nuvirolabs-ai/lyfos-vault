# Runbook: Reported account compromise

**Trigger:** A user emails saying "someone got into my account" or "I see
sessions / devices I don't recognise."

## Reassure first

Reply within 1 hour with the immediate-actions email
(`docs/runbooks/templates/account-compromise-email.md`). Vault contents are
encrypted with their passphrase, so unless the attacker also has the
passphrase, vault data is safe.

## Immediate actions (we do)

1. Verify identity: confirm email + recent activity from `audit_log`.
2. Sign out all sessions:
   ```sql
   delete from auth.refresh_tokens where user_id = '<user_id>';
   ```
3. Force a password reset via Supabase Dashboard → Authentication → Users →
   their row → "Send password recovery."
4. List all devices for them:
   ```sql
   select id, label, last_seen_at, created_at, user_agent
     from devices where user_id = '<user_id>' order by last_seen_at desc;
   ```
   Walk through which ones are theirs.
5. Pull the `audit_log` for the last 90 days for their user_id and look for
   unfamiliar IPs / unlock attempts / sync events.

## If vault was synced from an unfamiliar device

6. The encrypted blob is now on an attacker's device. They cannot decrypt it
   without the passphrase. Tell the user to:
   - Rotate the master passphrase (Settings → Security → Change passphrase).
   - Generate a new BIP39 recovery phrase.
   - Re-evaluate which key-holders should remain (one of them could be the
     attacker's social access; weight 3-of-5 carefully).
   - Replace key shares (Settings → Release plan → Replace shares).

## If billing PII was exposed

7. Check `billing_profile` for any change in name/address/GSTIN.
8. Razorpay does not expose card data even on full account compromise; no
   action needed there. But verify no subscriptions were created/cancelled
   maliciously.

## Document

9. Append `account_compromise_response` event to audit log with summary.
10. If > 5 such reports in a week, treat as a class issue and consider
    forcing universal passphrase rotation.

## What we cannot do

- We cannot recover the vault for the user. If the attacker also changed
  the passphrase and the user lost their recovery phrase, the vault is
  permanently inaccessible. This is by design.
- We cannot legally identify the attacker for the user. Direct them to
  cybercrime.gov.in for the FIR; we will cooperate with the police request.
