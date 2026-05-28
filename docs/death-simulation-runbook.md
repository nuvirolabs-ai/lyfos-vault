# Death Simulation Runbook — Lyfos Release Engine

> **Read this before opening up the Release feature to paying users.**
> Running this end-to-end is the acceptance test for Phase 3.

## Cast (7 humans)

| Role         | Email                          | What they do                                                          |
|--------------|--------------------------------|------------------------------------------------------------------------|
| Founder admin| founder@lyfos.signorvale.com   | Has `role:admin` in `raw_user_meta_data`. Reviews the claim.           |
| Owner        | owner@example.com              | Sets up a vault, finalizes a 5-of-5 release plan, then "dies".         |
| Nominee      | nominee@example.com            | Files the claim, eventually downloads the bundle.                      |
| Key holder 1 | h1@example.com                 | Accepts invite, releases share.                                        |
| Key holder 2 | h2@example.com                 | Accepts invite, releases share.                                        |
| Key holder 3 | h3@example.com                 | Accepts invite, releases share.                                        |
| Key holder 4 | h4@example.com                 | Accepts invite, **does NOT release** (proves 3-of-5 is sufficient).    |
| Key holder 5 | h5@example.com                 | Accepts invite, **does NOT release**.                                  |

You can use throwaway Gmail aliases (`founder+sim@gmail.com`, `founder+sim-h1@gmail.com`, …) for all 7 — they all forward to one inbox so a single person can play every role.

## Preconditions

- `lyfos.signorvale.com` is deployed with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set.
- All migrations `0001` through `0010` have been applied in Supabase SQL Editor.
- Storage buckets `death_certificates` and `release_downloads` exist (migration 0008 creates them).
- Resend is configured + sending domain verified. (MSG91 + WhatsApp can be unset; SMS/WhatsApp degrade gracefully.)
- Edge Functions deployed:
  - `send-key-holder-invite`
  - `release-alert-dispatcher`
  - `monthly-reminder`
- pg_cron jobs scheduled (migrations 0004 and 0009 ran).
- Founder admin role granted via SQL:
  ```sql
  update auth.users set raw_user_meta_data = raw_user_meta_data || '{"role":"admin"}'::jsonb
   where email = 'founder@lyfos.signorvale.com';
  ```

## Test track

### Phase A — Owner setup (~ 10 minutes)

1. **Owner** opens `https://lyfos.signorvale.com`, signs up, verifies email.
2. Creates a vault with a strong passphrase. Writes down the 24-word recovery phrase.
3. Adds 3–4 vault records, at least 2 of which are marked **emergency-eligible** (e.g. "Bank locker code", "Aadhaar location"). These are what the nominee will receive.
4. Goes to Vault → Release. Should see "Build your circle of five" + 3 readiness pills (0/0/0).
5. Invites 5 key holders by email (h1@…, h2@…, h3@…, h4@…, h5@…).
6. Confirms each got an email — for each, click the invite URL, sign up as that user, type a release passphrase (12+ chars), accept. Status flips to **Accepted**.
7. When all 5 are accepted, **Owner** sees a **"Finalize plan"** button. Confirm + type "finalize" + activate.
8. Status flips to **Verified** for all 5. Plan is now active.
9. **Owner** scrolls to **Claim link for your nominee**, sets up nominee label + email, copies the `/claim/<token>` URL. Sends it to **Nominee** out of band.

### Phase B — Nominee files claim (~ 5 minutes)

10. **Nominee** opens the `/claim/<token>` URL.
11. Reads the claim context, signs up using the expected nominee email, verifies email.
12. Uploads a sample death certificate PDF.
13. Submits. Sees "Your claim is in review" with reference id. **Keeps this browser tab open** (the release_process_secretKey is in `sessionStorage`).

### Phase C — Founder review (~ 2 minutes)

14. **Founder admin** opens `/admin`.
15. Sees the pending claim. Clicks "View certificate" — should open the PDF in a new tab via a 60-second signed URL.
16. Approves (with optional note).
17. **Owner** opens Lyfos — should see the prominent amber **Active release request · Approved · waiting for your key holders** banner at the top of the Home screen.

### Phase D — Key holders release (~ 5 minutes)

18. **Key holder 1** opens `https://lyfos.signorvale.com/hold-release`, signs in as h1@…, sees the pending release, types her release passphrase, releases her share.
19. **Owner** refreshes Home — banner now says **Key holders releasing**.
20. **Key holder 2** does the same.
21. **Key holder 3** does the same. At the moment the third share lands, the server `holder_release_share` RPC advances state to **`holding`** and stamps `ready_at = now() + 14 days`.
22. **Owner** refreshes Home — banner now says **Owner-protection hold · 14 days remaining**.

### Phase E — Owner does NOT abort (simulate death)

The 14-day hold is real wall-clock time. For the test, you have two options:

- **(A) Speed up via SQL**: in the SQL Editor, run
  ```sql
  update public.release_requests set ready_at = now() - interval '1 minute' where state = 'holding';
  ```
- **(B) Actually wait 14 days.** Recommended at least once before public launch so you can also test the daily alert cadence.

During the hold, the `release-alert-dispatcher` Edge Function fires hourly. The first hourly tick on each UTC day sends one email per holder request. If you've also set `MSG91_AUTH_KEY` + `MSG91_TEMPLATE_ID`, SMS goes. If `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` are set and your template is approved, WhatsApp goes. Each alert lands with a one-tap **Abort** link to `/release/abort`.

### Phase F — Hold expires + nominee downloads

23. Once `ready_at < now()`, the next dispatcher tick advances the state to **`ready_to_release`**. (Or manually call `select public.maybe_complete_hold(<request_id>)` from SQL.)
24. **Nominee** opens `https://lyfos.signorvale.com/download` (still the same browser session as the claim — this matters), signs in.
25. Sees status `ready_to_release · 3 of 5 shares released`.
26. Clicks **"Combine shares and download"**.
27. The browser:
    - Reads the release_process_secretKey from sessionStorage
    - Fetches the 3 released shares
    - Decrypts each with the nominee's secretKey
    - Combines via Shamir → raw vault key
    - Fetches the encrypted vault blob via `nominee_get_vault_blob` RPC
    - Decrypts client-side with the raw vault key
    - Filters to emergency-eligible records
    - Triggers a JSON download `lyfos-emergency-<date>.json`
    - Calls `nominee_mark_completed` → state moves to **`completed`**
28. **Open the downloaded JSON.** It should contain exactly the items the owner marked emergency-eligible. Bank locker codes etc. should be present in plaintext.

## Acceptance criteria

The test PASSES if and only if all of these are true:

- ✅ The downloaded JSON's `items[].title` exactly matches the emergency-eligible titles the owner created in Phase A step 3.
- ✅ The vault items NOT marked emergency-eligible are NOT present in the download.
- ✅ The owner received a daily email during the hold (check inbox).
- ✅ At any point before `ready_to_release`, the owner could click any alert's Abort link and the release would cancel.
- ✅ The state transitions in `release_requests` followed the legal sequence (`pending_review → approved → awaiting_shares → holding → ready_to_release → completed`) — verify in SQL Editor: `select id, state, created_at, approved_at, hold_started_at, ready_at, completed_at from release_requests order by created_at desc limit 1;`
- ✅ The `audit_log` table contains entries for: `release_claim_filed`, `release_approved`, `release_completed`, and a `key_holder_invite_sent` per holder.

If any of these fail, the bug needs to be fixed before the release feature is exposed to paying users.

## Cleanup after the test

```sql
-- Delete the simulated release request and everything cascading from it
delete from release_requests where nominee_email_at_request = 'nominee@example.com';
-- Delete the simulated owner's vault data
delete from auth.users where email in (
  'owner@example.com','nominee@example.com',
  'h1@example.com','h2@example.com','h3@example.com','h4@example.com','h5@example.com'
);
```

(The `on delete cascade` constraints on `key_holders`, `key_shares`, `release_requests`, `release_share_releases`, `release_alerts`, and `release_settings` will pick up the rest.)

## Rotation: run this quarterly

Lyfos's reliability isn't a one-time test. Run the end-to-end simulation:

- **Before every minor version bump** that touches release-engine code
- **Quarterly**, regardless of code changes, to verify pg_cron is still firing and Resend / MSG91 / WhatsApp credentials haven't lapsed
- **After any incident** that involves any of: Supabase, your email provider, or your DNS

Document each run in a short post in `docs/release-simulations/YYYY-MM-DD.md` — failures and resolutions are how trust compounds for a product like this.
