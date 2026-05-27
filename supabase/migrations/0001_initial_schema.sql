-- Lyfos initial schema. Run in Supabase SQL editor (or via supabase CLI).
-- This is the zero-knowledge layer: the server holds encrypted ciphertext
-- and metadata only. It must never see plaintext, passphrases, or derived
-- vault keys.
--
-- Apply order:
--   1. Create tables
--   2. Enable Row Level Security (RLS) on each
--   3. Apply policies so each authenticated user can ONLY touch their own rows
--   4. Helper trigger to keep updated_at fresh

-- ============================================================
-- vault_blobs
-- One row per user. Holds the encrypted JSON envelope of the
-- vault. We bump version on every write so the client can detect
-- conflicts (last-write-wins for v1; CRDT later if needed).
-- ============================================================
create table if not exists public.vault_blobs (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  ciphertext     bytea       not null,
  iv             text        not null,            -- base64 IV from AES-GCM
  algorithm      text        not null default 'AES-GCM',
  kdf            text        not null,            -- 'argon2id' | 'pbkdf2-sha256-600k'
  kdf_salt       text        not null,            -- base64
  kdf_params     jsonb       not null,            -- { iterations, memory_kib, parallelism, ... }
  version        integer     not null default 1,
  size_bytes     integer     not null,
  client_updated_at timestamptz not null,         -- when the client encrypted this
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists vault_blobs_updated_at_idx on public.vault_blobs (updated_at desc);

-- ============================================================
-- devices
-- Devices the user has signed in from. The client picks a stable
-- device_id per browser (random UUID stored in localStorage).
-- ============================================================
create table if not exists public.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  device_token  text not null,                    -- client-generated UUID per browser
  label         text,                             -- "Tanu's MacBook", set by user
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (user_id, device_token)
);

create index if not exists devices_user_idx on public.devices (user_id, last_seen_at desc);

-- ============================================================
-- recovery_envelopes
-- A second wrapped copy of the vault master key, sealed with the
-- recovery key (BIP39 phrase the user printed at signup). Used to
-- decrypt the vault if the user forgets their passphrase.
-- The recovery key itself is NEVER sent to the server.
-- ============================================================
create table if not exists public.recovery_envelopes (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  wrapped_key        text not null,               -- base64 ciphertext
  iv                 text not null,
  algorithm          text not null default 'AES-GCM',
  kdf                text not null,               -- 'argon2id' for recovery KDF
  kdf_salt           text not null,
  kdf_params         jsonb not null,
  fingerprint        text not null,               -- first 8 chars of sha256(recovery_pubkey) for UI display
  created_at         timestamptz not null default now(),
  rotated_at         timestamptz
);

-- ============================================================
-- audit_log
-- Server-side append-only event log. Sensitive details stay in
-- the encrypted vault's own client-side audit array; this is for
-- security-relevant server events (login, device added, blob
-- pushed, account deleted).
-- ============================================================
create table if not exists public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  event_type    text not null,
  event_meta    jsonb,                            -- DO NOT put PII or vault content here
  device_token  text,
  created_at    timestamptz not null default now()
);

create index if not exists audit_log_user_time_idx on public.audit_log (user_id, created_at desc);

-- ============================================================
-- updated_at trigger
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vault_blobs_touch_updated on public.vault_blobs;
create trigger vault_blobs_touch_updated
  before update on public.vault_blobs
  for each row execute function public.touch_updated_at();
