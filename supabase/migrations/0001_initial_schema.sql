-- Lyfos initial schema. Run in Supabase SQL editor (or via supabase CLI).
-- This is the zero-knowledge layer: the server holds the encrypted Stage 1
-- vault record (which itself contains the encrypted vault key envelopes
-- and the encrypted vault payload) plus thin sync metadata. It must never
-- see plaintext, passphrases, or derived vault keys.
--
-- Apply order:
--   1. Create tables
--   2. Enable Row Level Security (RLS) on each
--   3. Apply policies so each authenticated user can ONLY touch their own rows
--   4. Helper trigger to keep updated_at fresh

-- ============================================================
-- vault_blobs
-- One row per user. encrypted_record is the full Stage 1 vault record
-- as JSONB. The fields inside are public structure (KDF metadata,
-- algorithm names, etc.) but every secret value is AES-GCM ciphertext
-- that the server cannot decrypt.
--
-- version, size_bytes, client_updated_at exist as un-encrypted metadata
-- for sync conflict resolution and quota enforcement. They are derived
-- from the encrypted_record but stored separately so the server can
-- order and size-cap without parsing the JSON on every write.
-- ============================================================
create table if not exists public.vault_blobs (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  encrypted_record   jsonb       not null,
  version            integer     not null default 1,
  size_bytes         integer     not null,
  client_updated_at  timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists vault_blobs_updated_at_idx on public.vault_blobs (updated_at desc);

-- Hard size cap as defence-in-depth. Anything over 5 MiB is almost
-- certainly an attachment-spam attempt or a client bug.
alter table public.vault_blobs
  add constraint vault_blobs_size_sanity check (size_bytes <= 5 * 1024 * 1024);

-- ============================================================
-- devices
-- Browsers / native apps the user has signed in from. device_token is
-- a client-generated UUID stored in localStorage / SecureStore on that
-- device. label is user-editable so the device list reads like
-- "Tanu's MacBook", "iPhone 15".
-- ============================================================
create table if not exists public.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  device_token  text not null,
  label         text,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (user_id, device_token)
);

create index if not exists devices_user_idx on public.devices (user_id, last_seen_at desc);

-- ============================================================
-- recovery_envelopes
-- Stage 1 wraps the recovery key envelope INSIDE encrypted_record.
-- This table exists for future use (Stage 2 plans an out-of-band
-- escrow with key-holder Shamir shares) — leave it created but unused
-- for now so the migration doesn't need to drop-and-recreate later.
-- ============================================================
create table if not exists public.recovery_envelopes (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  wrapped_key        text not null,
  iv                 text not null,
  algorithm          text not null default 'AES-GCM',
  kdf                text not null,
  kdf_salt           text not null,
  kdf_params         jsonb not null,
  fingerprint        text not null,
  created_at         timestamptz not null default now(),
  rotated_at         timestamptz
);

-- ============================================================
-- audit_log
-- Server-side append-only event log for security-relevant events
-- (login, device added, blob pushed, account deleted). The richer,
-- vault-content-adjacent audit trail lives inside encrypted_record.
-- DO NOT put PII or vault content in event_meta.
-- ============================================================
create table if not exists public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  event_type    text not null,
  event_meta    jsonb,
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
