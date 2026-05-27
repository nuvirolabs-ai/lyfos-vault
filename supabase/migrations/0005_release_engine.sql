-- Lyfos release engine — schema + RLS + state machine helpers.
--
-- This is the central feature. Every line here was written with one
-- question in mind: "Could this allow a release to happen without
-- 3-of-5 verified humans + a 14-day owner hold?" If the answer is yes,
-- the constraint or policy is wrong.
--
-- Cryptographic model (documented here so it stays canon):
--
--   Owner has vault_key = AES-256 derived per-vault (Phase 1).
--   At release-plan finalize:
--     1. Owner splits vault_key into 5 SSS shares (3-of-5 threshold).
--     2. Each holder has uploaded a release_pubkey (Curve25519) derived
--        from their own Lyfos passphrase via Argon2id → HKDF.
--     3. Owner encrypts share[i] to holder[i]'s release_pubkey using
--        NaCl box (X25519 + ChaCha20-Poly1305). Stored in key_shares.
--   At release-execute:
--     1. Nominee posts a release_request with a release_process_pubkey
--        she generated fresh for this request.
--     2. Each holder unlocks her own share with her account passphrase,
--        re-encrypts the share to the nominee's release_process_pubkey,
--        writes it to release_share_releases.
--     3. After 14-day hold completes AND ≥3 shares released, nominee
--        decrypts each released share with her release_process_privkey,
--        combines via SSS, gets vault_key, decrypts owner's vault blob
--        client-side. Server never sees plaintext.
--
-- The server enforces the *process*, not the secrets. RLS keeps shares
-- visible only to the right people; the timer is server-time enforced
-- because client time is forgeable.

-- ============================================================
-- key_holders
-- Owner's 5 chosen key holders. holder_user_id is null until the
-- invited human creates a Lyfos account and accepts. status moves
-- pending → accepted → verified (verified = their release_pubkey is on
-- file and a share is provisioned for them).
-- ============================================================
create table if not exists public.key_holders (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  holder_user_id    uuid references auth.users(id) on delete set null,
  holder_email      text not null,
  holder_phone      text,
  label             text not null,                       -- "Vikram Sharma (brother)"
  invite_token      text not null unique,
  release_pubkey    text,                                 -- base64 Curve25519 public key, set on accept
  status            text not null default 'pending',     -- pending | accepted | verified | revoked
  created_at        timestamptz not null default now(),
  accepted_at       timestamptz,
  verified_at       timestamptz,
  revoked_at        timestamptz,
  unique (owner_id, holder_email)
);

create index if not exists key_holders_owner_idx on public.key_holders (owner_id);
create index if not exists key_holders_holder_idx on public.key_holders (holder_user_id) where holder_user_id is not null;
create index if not exists key_holders_invite_idx on public.key_holders (invite_token);

-- ============================================================
-- key_shares
-- The 5 encrypted SSS shares of the vault key. One row per holder.
-- ciphertext is what the holder's release_privkey can unwrap to
-- reveal their raw share. The server cannot decrypt these.
-- ============================================================
create table if not exists public.key_shares (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  key_holder_id   uuid not null references public.key_holders(id) on delete cascade,
  share_index     integer not null check (share_index between 1 and 5),
  ciphertext      text not null,                          -- base64 NaCl box output
  ephemeral_pub   text not null,                          -- base64 sender ephemeral public key
  algorithm       text not null default 'nacl-box-x25519-chacha20poly1305',
  sss_threshold   integer not null default 3,
  sss_total       integer not null default 5,
  created_at      timestamptz not null default now(),
  unique (owner_id, key_holder_id),
  unique (owner_id, share_index)
);

-- ============================================================
-- release_requests
-- A nominee asking for the owner's vault to be released. The state
-- column drives the whole UX. Two timers we enforce server-side:
-- approved_at (after founder reviews) and hold_started_at (after
-- 3rd share is released). hold_started_at + 14 days = ready.
-- ============================================================
create table if not exists public.release_requests (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 uuid not null references auth.users(id) on delete cascade,
  nominee_user_id          uuid not null references auth.users(id) on delete restrict,
  nominee_email_at_request text not null,
  release_process_pubkey   text not null,                 -- nominee's per-request Curve25519 pub
  state                    text not null default 'pending_review',
                           -- pending_review | rejected | approved
                           -- | awaiting_shares | holding | ready_to_release
                           -- | completed | cancelled
  death_certificate_path   text,                          -- supabase storage path
  rejection_reason         text,
  cancel_reason            text,
  created_at               timestamptz not null default now(),
  approved_at              timestamptz,
  approved_by              uuid references auth.users(id),
  hold_started_at          timestamptz,
  ready_at                 timestamptz,                   -- hold_started_at + 14 days, computed at transition
  completed_at             timestamptz,
  cancelled_at             timestamptz,
  reviewed_at              timestamptz,
  check (state in (
    'pending_review','rejected','approved','awaiting_shares',
    'holding','ready_to_release','completed','cancelled'
  ))
);

create index if not exists release_requests_owner_idx on public.release_requests (owner_id);
create index if not exists release_requests_nominee_idx on public.release_requests (nominee_user_id);
create index if not exists release_requests_state_idx on public.release_requests (state);
create index if not exists release_requests_ready_idx on public.release_requests (ready_at) where ready_at is not null and state = 'holding';

-- At most one in-flight release per owner.
create unique index if not exists release_requests_owner_inflight_idx
  on public.release_requests (owner_id)
  where state in ('pending_review','approved','awaiting_shares','holding','ready_to_release');

-- ============================================================
-- release_share_releases
-- One row per share the key holder has approved + re-encrypted to
-- the nominee's release_process_pubkey. The server can see who
-- released and when, but never the share plaintext.
-- ============================================================
create table if not exists public.release_share_releases (
  id                    uuid primary key default gen_random_uuid(),
  release_request_id    uuid not null references public.release_requests(id) on delete cascade,
  key_holder_id         uuid not null references public.key_holders(id) on delete restrict,
  share_index           integer not null,
  ciphertext            text not null,                    -- holder → nominee NaCl box ciphertext
  ephemeral_pub         text not null,
  released_at           timestamptz not null default now(),
  unique (release_request_id, key_holder_id),
  unique (release_request_id, share_index)
);

create index if not exists release_share_releases_request_idx on public.release_share_releases (release_request_id);

-- ============================================================
-- release_alerts
-- Every alert sent to the owner during the 14-day hold. Used so we
-- never double-send on a given day and so the audit log can prove
-- the owner had opportunity to abort.
-- ============================================================
create table if not exists public.release_alerts (
  id                    uuid primary key default gen_random_uuid(),
  release_request_id    uuid not null references public.release_requests(id) on delete cascade,
  channel               text not null,                    -- 'email' | 'sms' | 'whatsapp' | 'push'
  abort_token           text not null,
  status                text not null default 'sent',     -- sent | failed | delivered
  provider_message_id   text,
  sent_at               timestamptz not null default now(),
  delivered_at          timestamptz,
  failure_reason        text
);

create index if not exists release_alerts_request_idx on public.release_alerts (release_request_id, sent_at desc);
create index if not exists release_alerts_token_idx on public.release_alerts (abort_token);

-- ============================================================
-- Trigger: stamp ready_at when state moves to 'holding'.
-- Hold = 14 days. Day count is server-side so a clock-skewed client
-- can never bypass it.
-- ============================================================
create or replace function public.touch_release_ready_at()
returns trigger
language plpgsql
as $$
begin
  if new.state = 'holding' and (old.state is null or old.state <> 'holding') then
    new.hold_started_at = coalesce(new.hold_started_at, now());
    new.ready_at = new.hold_started_at + interval '14 days';
  end if;
  return new;
end;
$$;

drop trigger if exists release_requests_touch_ready on public.release_requests;
create trigger release_requests_touch_ready
  before update on public.release_requests
  for each row execute function public.touch_release_ready_at();
