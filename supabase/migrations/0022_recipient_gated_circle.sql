-- Recipient-gated Circle of Trust.
-- Local migration only until the production migration ledger is reconciled.

create extension if not exists pgcrypto;

-- ============================================================
-- Nominee roles, hashed invitations, and stable key versions
-- ============================================================

alter table public.key_holders
  add column if not exists role text not null default 'trusted',
  add column if not exists invite_token_hash text,
  add column if not exists invite_expires_at timestamptz,
  add column if not exists invite_consumed_at timestamptz,
  add column if not exists recovery_key_version integer not null default 1,
  add column if not exists circle_generation integer not null default 0;

update public.key_holders
   set invite_token_hash = encode(digest(convert_to(invite_token, 'UTF8'), 'sha256'), 'hex')
 where invite_token_hash is null
   and invite_token is not null;

update public.key_holders
   set invite_expires_at = created_at + interval '30 days'
 where invite_expires_at is null
   and status = 'pending';

update public.key_holders
   set invite_token = null
 where invite_token_hash is not null;

alter table public.key_holders alter column invite_token drop not null;
alter table public.key_holders drop constraint if exists key_holders_role_check;
alter table public.key_holders
  add constraint key_holders_role_check check (role in ('primary', 'backup', 'trusted'));
alter table public.key_holders drop constraint if exists key_holders_recovery_key_version_check;
alter table public.key_holders
  add constraint key_holders_recovery_key_version_check check (recovery_key_version > 0);

create unique index if not exists key_holders_invite_token_hash_idx
  on public.key_holders (invite_token_hash)
  where invite_token_hash is not null;

create unique index if not exists key_holders_one_primary_idx
  on public.key_holders (owner_id)
  where role = 'primary' and status <> 'revoked';

create unique index if not exists key_holders_one_backup_idx
  on public.key_holders (owner_id)
  where role = 'backup' and status <> 'revoked';

-- ============================================================
-- Circle generations and recipient envelopes
-- ============================================================

create table if not exists public.circle_generations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  generation integer not null,
  state text not null default 'active' check (state in ('active', 'superseded')),
  algorithm text not null default 'recipient-gate-xor-sss-2of5-v1',
  primary_holder_id uuid not null references public.key_holders(id) on delete restrict,
  backup_holder_id uuid not null references public.key_holders(id) on delete restrict,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (owner_id, generation),
  check (primary_holder_id <> backup_holder_id)
);

create unique index if not exists circle_generations_one_active_idx
  on public.circle_generations (owner_id)
  where state = 'active';

create table if not exists public.recipient_gate_envelopes (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.circle_generations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  recipient_holder_id uuid not null references public.key_holders(id) on delete restrict,
  recipient_role text not null check (recipient_role in ('primary', 'backup')),
  recipient_key_version integer not null check (recipient_key_version > 0),
  ciphertext text not null,
  ephemeral_pub text not null,
  instructions_ciphertext text,
  instructions_ephemeral_pub text,
  created_at timestamptz not null default now(),
  unique (generation_id, recipient_role),
  unique (generation_id, recipient_holder_id)
);

alter table public.key_shares
  add column if not exists generation_id uuid references public.circle_generations(id) on delete cascade,
  add column if not exists share_commitment text;

alter table public.key_shares alter column sss_threshold set default 2;

-- ============================================================
-- Observable email delivery
-- ============================================================

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('holder_invite', 'auth_confirmation', 'magic_link', 'password_reset', 'recovery_support', 'owner_alert', 'release_alert')),
  related_holder_id uuid references public.key_holders(id) on delete cascade,
  related_request_id uuid references public.release_requests(id) on delete cascade,
  recipient_email text not null,
  state text not null default 'queued' check (state in ('queued', 'sent', 'delivered', 'delayed', 'bounced', 'suppressed', 'failed')),
  idempotency_key text not null unique,
  provider_message_id text unique,
  attempt integer not null default 1 check (attempt > 0),
  failure_reason text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists email_deliveries_holder_idx
  on public.email_deliveries (related_holder_id, created_at desc);

create table if not exists public.email_delivery_events (
  event_id text primary key,
  provider_message_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  received_at timestamptz not null default now()
);

-- Raw invite tokens are kept only in this service-role outbox. Owners can
-- still copy the one-time token returned by the RPC, but an interrupted
-- browser is no longer the only process capable of delivering the email.
create table if not exists public.invite_email_outbox (
  delivery_id uuid primary key references public.email_deliveries(id) on delete cascade,
  invite_token text not null check (length(invite_token) >= 24),
  created_at timestamptz not null default now()
);

create table if not exists public.recovery_support_refusals (
  id uuid primary key default gen_random_uuid(),
  release_request_id uuid not null references public.release_requests(id) on delete cascade,
  key_holder_id uuid not null references public.key_holders(id) on delete cascade,
  reason text,
  refused_at timestamptz not null default now(),
  unique (release_request_id, key_holder_id)
);

-- ============================================================
-- Recovery request recipient binding
-- ============================================================

alter table public.release_requests
  add column if not exists recipient_holder_id uuid references public.key_holders(id) on delete restrict,
  add column if not exists circle_generation_id uuid references public.circle_generations(id) on delete restrict,
  add column if not exists recipient_role text,
  add column if not exists recipient_key_version integer,
  add column if not exists request_kind text not null default 'normal',
  add column if not exists fallback_reason text,
  add column if not exists evidence_summary text,
  add column if not exists recovery_encrypted_record jsonb;

alter table public.release_requests alter column release_process_pubkey drop not null;
alter table public.release_requests drop constraint if exists release_requests_recipient_role_check;
alter table public.release_requests
  add constraint release_requests_recipient_role_check
  check (recipient_role is null or recipient_role in ('primary', 'backup'));
alter table public.release_requests drop constraint if exists release_requests_request_kind_check;
alter table public.release_requests
  add constraint release_requests_request_kind_check check (request_kind in ('normal', 'backup'));
alter table public.release_requests drop constraint if exists release_requests_state_check;
alter table public.release_requests
  add constraint release_requests_state_check check (state in (
    'draft', 'under_review', 'collecting_support', 'holding', 'ready_to_recover',
    'opened', 'rejected', 'aborted', 'expired',
    'pending_review', 'approved', 'awaiting_shares', 'ready_to_release', 'completed', 'cancelled'
  ));

drop index if exists public.release_requests_owner_inflight_idx;
create unique index release_requests_owner_inflight_idx
  on public.release_requests (owner_id)
  where state in (
    'draft', 'under_review', 'collecting_support', 'holding', 'ready_to_recover',
    'pending_review', 'approved', 'awaiting_shares', 'ready_to_release'
  );

-- ============================================================
-- RLS
-- ============================================================

alter table public.circle_generations enable row level security;
alter table public.recipient_gate_envelopes enable row level security;
alter table public.email_deliveries enable row level security;
alter table public.email_delivery_events enable row level security;
alter table public.invite_email_outbox enable row level security;
alter table public.recovery_support_refusals enable row level security;

revoke all on public.invite_email_outbox from public, anon, authenticated;

drop policy if exists "death_cert admin read" on storage.objects;
create policy "death_cert admin read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'death_certificates'
    and coalesce((select raw_app_meta_data->>'role' from auth.users where id = auth.uid()), '') = 'admin'
  );

drop policy if exists "owner reads own circle generations" on public.circle_generations;
create policy "owner reads own circle generations"
  on public.circle_generations for select
  using (auth.uid() = owner_id);

drop policy if exists "owner reads own recipient envelopes" on public.recipient_gate_envelopes;
create policy "owner reads own recipient envelopes"
  on public.recipient_gate_envelopes for select
  using (auth.uid() = owner_id);

drop policy if exists "owner reads invite delivery" on public.email_deliveries;
create policy "owner reads invite delivery"
  on public.email_deliveries for select
  using (
    exists (
      select 1 from public.key_holders h
       where h.id = email_deliveries.related_holder_id
         and h.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.release_requests r
       where r.id = email_deliveries.related_request_id
         and r.owner_id = auth.uid()
    )
  );

drop policy if exists "nominee creates own request" on public.release_requests;
drop policy if exists "holder inserts own share release" on public.release_share_releases;
drop policy if exists "nominee reads releases for own request" on public.release_share_releases;
create policy "recipient reads ready supporting releases"
  on public.release_share_releases for select
  using (
    exists (
      select 1 from public.release_requests r
       where r.id = release_share_releases.release_request_id
         and r.nominee_user_id = auth.uid()
         and r.state in ('ready_to_recover', 'opened')
    )
  );

-- ============================================================
-- Invitation helpers using token hashes
-- ============================================================

create or replace function public.hash_circle_token(p_token text)
returns text
language sql
immutable
strict
set search_path = public, extensions
as $$
  select encode(digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.create_key_holder_invite(
  p_holder_email text,
  p_holder_phone text,
  p_label text,
  p_role text default 'trusted'
)
returns table (invite_id uuid, invite_token text, delivery_id uuid)
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_email text := lower(trim(p_holder_email));
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_invite uuid;
  v_delivery uuid;
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  if p_role not in ('primary', 'backup', 'trusted') then raise exception 'invalid nominee role'; end if;
  if p_label is null or length(trim(p_label)) = 0 then raise exception 'label is required'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'valid email is required'; end if;

  delete from public.key_holders
   where owner_id = v_owner and lower(holder_email) = v_email and status = 'revoked';

  insert into public.key_holders (
    owner_id, holder_email, holder_phone, label, role,
    invite_token, invite_token_hash, invite_expires_at, status
  ) values (
    v_owner, v_email, nullif(trim(p_holder_phone), ''), trim(p_label), p_role,
    null, public.hash_circle_token(v_token), now() + interval '30 days', 'pending'
  ) returning id into v_invite;

  insert into public.email_deliveries (
    purpose, related_holder_id, recipient_email, idempotency_key
  ) values (
    'holder_invite', v_invite, v_email, 'holder-invite:' || v_invite::text || ':1'
  ) returning id into v_delivery;

  insert into public.invite_email_outbox (delivery_id, invite_token)
  values (v_delivery, v_token);

  return query select v_invite, v_token, v_delivery;
end;
$$;

grant execute on function public.create_key_holder_invite(text, text, text, text) to authenticated;

create or replace function public.requeue_key_holder_invite(p_holder_id uuid)
returns table (invite_token text, delivery_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_email text;
  v_attempt integer;
  v_delivery uuid;
  v_last_attempt timestamptz;
begin
  select holder_email into v_email
    from public.key_holders
   where id = p_holder_id and owner_id = v_owner and status = 'pending'
   for update;
  if v_email is null then raise exception 'pending invite not found'; end if;

  select max(created_at) into v_last_attempt
    from public.email_deliveries where related_holder_id = p_holder_id;
  if v_last_attempt is not null and v_last_attempt > now() - interval '60 seconds' then
    raise exception 'invite resend is available after 60 seconds';
  end if;

  select coalesce(max(attempt), 0) + 1 into v_attempt
    from public.email_deliveries where related_holder_id = p_holder_id;

  delete from public.invite_email_outbox o
   using public.email_deliveries d
   where o.delivery_id = d.id and d.related_holder_id = p_holder_id;
  update public.email_deliveries
     set state = 'failed', failure_reason = 'superseded by a newer invite', updated_at = now()
   where related_holder_id = p_holder_id and state in ('queued', 'delayed', 'failed');

  update public.key_holders
     set invite_token_hash = public.hash_circle_token(v_token),
         invite_expires_at = now() + interval '30 days'
   where id = p_holder_id;

  insert into public.email_deliveries (
    purpose, related_holder_id, recipient_email, idempotency_key, attempt
  ) values (
    'holder_invite', p_holder_id, v_email,
    'holder-invite:' || p_holder_id::text || ':' || v_attempt::text,
    v_attempt
  ) returning id into v_delivery;

  insert into public.invite_email_outbox (delivery_id, invite_token)
  values (v_delivery, v_token);

  return query select v_token, v_delivery;
end;
$$;

grant execute on function public.requeue_key_holder_invite(uuid) to authenticated;

drop function if exists public.peek_invite(text);
create function public.peek_invite(p_token text)
returns table (
  invite_id uuid,
  owner_email text,
  holder_label text,
  holder_email text,
  holder_role text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  select h.id, u.email::text, h.label, h.holder_email, h.role, h.status, h.created_at
    from public.key_holders h
    join auth.users u on u.id = h.owner_id
   where h.invite_token_hash = public.hash_circle_token(p_token)
     and h.status = 'pending'
     and h.invite_consumed_at is null
     and h.invite_expires_at > now()
   limit 1;
$$;

grant execute on function public.peek_invite(text) to anon, authenticated;

create or replace function public.accept_invite(p_token text, p_release_pubkey text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_email text;
  v_holder public.key_holders%rowtype;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  if p_release_pubkey is null or length(p_release_pubkey) < 32 then raise exception 'release public key required'; end if;
  select lower(email) into v_email from auth.users where id = v_caller;

  select * into v_holder
    from public.key_holders
   where invite_token_hash = public.hash_circle_token(p_token)
   for update;

  if v_holder.id is null then raise exception 'invite not found'; end if;
  if v_holder.status <> 'pending' or v_holder.invite_consumed_at is not null then raise exception 'invite is no longer active'; end if;
  if v_holder.invite_expires_at <= now() then raise exception 'invite expired'; end if;
  if lower(v_holder.holder_email) <> v_email then raise exception 'sign in with the email this invite was sent to'; end if;

  update public.key_holders
     set holder_user_id = v_caller,
         release_pubkey = p_release_pubkey,
         recovery_key_version = recovery_key_version + case when release_pubkey is null then 0 else 1 end,
         status = 'accepted',
         accepted_at = coalesce(accepted_at, now()),
         invite_consumed_at = now()
   where id = v_holder.id;

  delete from public.invite_email_outbox o
   using public.email_deliveries d
   where o.delivery_id = d.id
     and d.related_holder_id = v_holder.id;

  return v_holder.id;
end;
$$;

grant execute on function public.accept_invite(text, text) to authenticated;

-- ============================================================
-- Atomic generation activation
-- ============================================================

create or replace function public.activate_circle_generation(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_generation integer;
  v_generation_id uuid;
  v_primary public.key_holders%rowtype;
  v_backup public.key_holders%rowtype;
  v_share jsonb;
  v_primary_env jsonb := p_payload->'primary';
  v_backup_env jsonb := p_payload->'backup';
begin
  if v_owner is null then raise exception 'not authenticated'; end if;
  if p_payload->>'algorithm' <> 'recipient-gate-xor-sss-2of5-v1' then raise exception 'unsupported recovery algorithm'; end if;
  if jsonb_array_length(coalesce(p_payload->'shares', '[]'::jsonb)) <> 5 then raise exception 'exactly five shares are required'; end if;
  if (select count(*) from public.key_holders where owner_id = v_owner and status in ('accepted', 'verified') and release_pubkey is not null) <> 5 then
    raise exception 'five accepted nominees with recovery keys are required';
  end if;

  select * into v_primary from public.key_holders
   where owner_id = v_owner and role = 'primary' and status in ('accepted', 'verified');
  select * into v_backup from public.key_holders
   where owner_id = v_owner and role = 'backup' and status in ('accepted', 'verified');
  if v_primary.id is null or v_backup.id is null then raise exception 'primary and backup are required'; end if;
  if (v_primary_env->>'holder_id')::uuid <> v_primary.id then raise exception 'primary envelope does not match primary nominee'; end if;
  if (v_backup_env->>'holder_id')::uuid <> v_backup.id then raise exception 'backup envelope does not match backup nominee'; end if;
  if exists (select 1 from public.release_requests where owner_id = v_owner and state in ('under_review', 'collecting_support', 'holding', 'ready_to_recover')) then
    raise exception 'an active recovery blocks re-sealing';
  end if;

  select coalesce(max(generation), 0) + 1 into v_generation
    from public.circle_generations where owner_id = v_owner;

  update public.circle_generations
     set state = 'superseded', superseded_at = now()
   where owner_id = v_owner and state = 'active';

  insert into public.circle_generations (owner_id, generation, primary_holder_id, backup_holder_id)
  values (v_owner, v_generation, v_primary.id, v_backup.id)
  returning id into v_generation_id;

  delete from public.key_shares where owner_id = v_owner;

  for v_share in select value from jsonb_array_elements(p_payload->'shares') loop
    if not exists (
      select 1 from public.key_holders
       where id = (v_share->>'holder_id')::uuid
         and owner_id = v_owner
         and status in ('accepted', 'verified')
    ) then raise exception 'share holder is not ready'; end if;
    if coalesce(v_share->>'commitment', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'share commitment is required';
    end if;

    insert into public.key_shares (
      owner_id, key_holder_id, share_index, ciphertext, ephemeral_pub,
      sss_threshold, sss_total, generation_id, share_commitment
    ) values (
      v_owner,
      (v_share->>'holder_id')::uuid,
      (v_share->>'share_index')::integer,
      v_share->>'ciphertext',
      v_share->>'ephemeral_pub',
      2, 5, v_generation_id, v_share->>'commitment'
    );
  end loop;

  insert into public.recipient_gate_envelopes (
    generation_id, owner_id, recipient_holder_id, recipient_role, recipient_key_version,
    ciphertext, ephemeral_pub, instructions_ciphertext, instructions_ephemeral_pub
  ) values
  (
    v_generation_id, v_owner, v_primary.id, 'primary', v_primary.recovery_key_version,
    v_primary_env->>'ciphertext', v_primary_env->>'ephemeral_pub',
    v_primary_env->>'instructions_ciphertext', v_primary_env->>'instructions_ephemeral_pub'
  ),
  (
    v_generation_id, v_owner, v_backup.id, 'backup', v_backup.recovery_key_version,
    v_backup_env->>'ciphertext', v_backup_env->>'ephemeral_pub',
    v_backup_env->>'instructions_ciphertext', v_backup_env->>'instructions_ephemeral_pub'
  );

  update public.key_holders
     set status = 'verified', verified_at = coalesce(verified_at, now()), circle_generation = v_generation
   where owner_id = v_owner and status = 'accepted';

  return v_generation_id;
end;
$$;

grant execute on function public.activate_circle_generation(jsonb) to authenticated;

-- ============================================================
-- Authenticated recovery and two supporting shares
-- ============================================================

create or replace function public.my_entrusted_vaults()
returns table (
  holder_id uuid,
  owner_id uuid,
  owner_email text,
  holder_label text,
  holder_role text,
  holder_status text,
  generation_id uuid
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select h.id, h.owner_id, u.email::text, h.label, h.role, h.status, g.id
    from public.key_holders h
    join auth.users u on u.id = h.owner_id
    left join public.circle_generations g on g.owner_id = h.owner_id and g.state = 'active'
   where h.holder_user_id = auth.uid()
     and h.status = 'verified'
     and h.role in ('primary', 'backup')
   order by h.created_at desc;
$$;

grant execute on function public.my_entrusted_vaults() to authenticated;

create or replace function public.get_entrusted_instructions(p_holder_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'ciphertext', e.instructions_ciphertext,
    'ephemeralPub', e.instructions_ephemeral_pub
  ) into v_result
    from public.key_holders h
    join public.circle_generations g
      on g.owner_id = h.owner_id and g.state = 'active'
    join public.recipient_gate_envelopes e
      on e.generation_id = g.id and e.recipient_holder_id = h.id
   where h.id = p_holder_id
     and h.holder_user_id = auth.uid()
     and h.status = 'verified'
     and h.role in ('primary', 'backup')
     and e.recipient_key_version = h.recovery_key_version;
  if v_result is null then raise exception 'entrusted instructions not found'; end if;
  return v_result;
end;
$$;

grant execute on function public.get_entrusted_instructions(uuid) to authenticated;

create or replace function public.recipient_gated_holder_context(p_request_id uuid)
returns table (
  owner_id uuid,
  holder_id uuid,
  holder_label text,
  holder_role text,
  holder_status text,
  share_released boolean,
  support_refused boolean,
  recipient_holder_id uuid,
  recipient_pubkey text,
  request_state text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_request public.release_requests%rowtype;
  v_recipient_pubkey text;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select * into v_request from public.release_requests where id = p_request_id;
  if v_request.id is null then raise exception 'request not found'; end if;
  if not exists (
    select 1 from public.key_holders h
     where h.owner_id = v_request.owner_id
       and h.holder_user_id = v_caller
       and h.status = 'verified'
  ) then raise exception 'not a verified nominee for this owner'; end if;

  select release_pubkey into v_recipient_pubkey
    from public.key_holders where id = v_request.recipient_holder_id;

  return query
    select v_request.owner_id,
           h.id,
           h.label,
           h.role,
           h.status,
           exists (
             select 1 from public.release_share_releases s
              where s.release_request_id = p_request_id and s.key_holder_id = h.id
           ),
           exists (
             select 1 from public.recovery_support_refusals f
              where f.release_request_id = p_request_id and f.key_holder_id = h.id
           ),
           v_request.recipient_holder_id,
           v_recipient_pubkey,
           v_request.state
      from public.key_holders h
     where h.owner_id = v_request.owner_id and h.status <> 'revoked'
     order by h.created_at asc;
end;
$$;

grant execute on function public.recipient_gated_holder_context(uuid) to authenticated;

create or replace function public.create_relationship_recovery_request(
  p_holder_id uuid,
  p_request_kind text,
  p_fallback_reason text default null,
  p_evidence_summary text default null,
  p_evidence_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_email text;
  v_holder public.key_holders%rowtype;
  v_generation uuid;
  v_request uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select * into v_holder from public.key_holders
   where id = p_holder_id and holder_user_id = v_caller and status = 'verified';
  if v_holder.id is null then raise exception 'entrusted vault not found'; end if;
  if p_request_kind = 'normal' and v_holder.role <> 'primary' then raise exception 'only the primary can start normal recovery'; end if;
  if p_request_kind = 'backup' and v_holder.role <> 'backup' then raise exception 'only the backup can start fallback recovery'; end if;
  if p_request_kind = 'backup' and coalesce(length(trim(p_fallback_reason)), 0) < 10 then raise exception 'fallback reason is required'; end if;
  if coalesce(length(trim(p_evidence_summary)), 0) < 20 or coalesce(length(trim(p_evidence_path)), 0) = 0 then
    raise exception 'evidence summary and document are required';
  end if;
  if p_evidence_path not like v_caller::text || '/%' then raise exception 'evidence document does not belong to this account'; end if;
  select id into v_generation from public.circle_generations
   where owner_id = v_holder.owner_id and state = 'active';
  if v_generation is null then raise exception 'circle is not active'; end if;

  select email::text into v_email from auth.users where id = v_caller;
  insert into public.release_requests (
    owner_id, nominee_user_id, nominee_email_at_request, state,
    recipient_holder_id, circle_generation_id, recipient_role, recipient_key_version,
    request_kind, fallback_reason, evidence_summary, death_certificate_path
  ) values (
    v_holder.owner_id, v_caller, v_email, 'under_review',
    v_holder.id, v_generation, v_holder.role, v_holder.recovery_key_version,
    p_request_kind, nullif(trim(p_fallback_reason), ''), nullif(trim(p_evidence_summary), ''), p_evidence_path
  ) returning id into v_request;
  return v_request;
end;
$$;

grant execute on function public.create_relationship_recovery_request(uuid, text, text, text, text) to authenticated;

create or replace function public.release_supporting_share(
  p_request_id uuid,
  p_ciphertext text,
  p_ephemeral_pub text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_request public.release_requests%rowtype;
  v_holder public.key_holders%rowtype;
  v_share_index integer;
  v_count integer;
begin
  if p_ciphertext is null
     or p_ciphertext !~ '^[A-Za-z0-9+/]+={0,2}$'
     or length(p_ciphertext) % 4 <> 0
     or octet_length(decode(p_ciphertext, 'base64')) <> 139
     or p_ephemeral_pub is null
     or p_ephemeral_pub !~ '^[A-Za-z0-9+/]+={0,2}$'
     or length(p_ephemeral_pub) % 4 <> 0
     or octet_length(decode(p_ephemeral_pub, 'base64')) <> 32 then
    raise exception 'supporting key envelope is malformed';
  end if;

  select * into v_request from public.release_requests where id = p_request_id for update;
  if v_request.id is null or v_request.state <> 'collecting_support' then raise exception 'request is not collecting support'; end if;
  select * into v_holder from public.key_holders
   where owner_id = v_request.owner_id and holder_user_id = v_caller and status = 'verified';
  if v_holder.id is null then raise exception 'not a verified nominee for this owner'; end if;
  if v_holder.id = v_request.recipient_holder_id then raise exception 'recipient share cannot count as support'; end if;
  if exists (
    select 1 from public.recovery_support_refusals
     where release_request_id = p_request_id and key_holder_id = v_holder.id
  ) then raise exception 'this nominee already refused the recovery request'; end if;

  select share_index into v_share_index from public.key_shares
   where owner_id = v_request.owner_id
     and key_holder_id = v_holder.id
     and generation_id = v_request.circle_generation_id;
  if v_share_index is null then raise exception 'supporting share not found'; end if;

  insert into public.release_share_releases (
    release_request_id, key_holder_id, share_index, ciphertext, ephemeral_pub
  ) values (p_request_id, v_holder.id, v_share_index, p_ciphertext, p_ephemeral_pub)
  on conflict (release_request_id, key_holder_id) do nothing;

  select count(*) into v_count from public.release_share_releases where release_request_id = p_request_id;
  if v_count >= 2 then
    update public.release_requests set state = 'holding' where id = p_request_id and state = 'collecting_support';
  end if;
  return least(v_count, 2);
end;
$$;

grant execute on function public.release_supporting_share(uuid, text, text) to authenticated;

create or replace function public.recipient_recovery_progress(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_request public.release_requests%rowtype;
  v_total integer;
  v_approved integer;
  v_refused integer;
begin
  select * into v_request from public.release_requests
   where id = p_request_id and nominee_user_id = auth.uid();
  if v_request.id is null then raise exception 'recovery request not found'; end if;

  select count(*) into v_total from public.key_holders h
   where h.owner_id = v_request.owner_id
     and h.status = 'verified'
     and h.id <> v_request.recipient_holder_id;
  select count(*) into v_approved from public.release_share_releases s
   where s.release_request_id = p_request_id;
  select count(*) into v_refused from public.recovery_support_refusals f
   where f.release_request_id = p_request_id;

  return jsonb_build_object(
    'approved', v_approved,
    'refused', v_refused,
    'waiting', greatest(v_total - v_approved - v_refused, 0),
    'required', 2
  );
end;
$$;

grant execute on function public.recipient_recovery_progress(uuid) to authenticated;

create or replace function public.refuse_recovery_support(p_request_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_request public.release_requests%rowtype;
  v_holder uuid;
begin
  select * into v_request from public.release_requests where id = p_request_id for update;
  if v_request.id is null or v_request.state <> 'collecting_support' then raise exception 'request is not collecting support'; end if;
  select id into v_holder from public.key_holders
   where owner_id = v_request.owner_id and holder_user_id = v_caller and status = 'verified';
  if v_holder is null then raise exception 'not a verified nominee for this owner'; end if;
  if v_holder = v_request.recipient_holder_id then raise exception 'recipient cannot refuse their own recovery request'; end if;
  if exists (
    select 1 from public.release_share_releases
     where release_request_id = p_request_id and key_holder_id = v_holder
  ) then raise exception 'this nominee already released support'; end if;

  insert into public.recovery_support_refusals (release_request_id, key_holder_id, reason)
  values (p_request_id, v_holder, nullif(trim(p_reason), ''))
  on conflict (release_request_id, key_holder_id) do nothing;
end;
$$;

grant execute on function public.refuse_recovery_support(uuid, text) to authenticated;

create or replace function public.get_ready_recovery_material(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_request public.release_requests%rowtype;
  v_generation uuid;
  v_encrypted_record jsonb;
  v_result jsonb;
begin
  select * into v_request from public.release_requests where id = p_request_id for update;
  if v_request.id is null or v_request.nominee_user_id <> v_caller then raise exception 'recovery request not found'; end if;
  if v_request.state = 'holding' and v_request.ready_at <= now() then
    update public.release_requests set state = 'ready_to_recover' where id = p_request_id;
    v_request.state := 'ready_to_recover';
  end if;
  if v_request.state not in ('ready_to_recover', 'opened') then raise exception 'recovery is not ready'; end if;

  v_generation := v_request.circle_generation_id;
  v_encrypted_record := v_request.recovery_encrypted_record;
  if v_encrypted_record is null then
    select encrypted_record into v_encrypted_record
      from public.vault_blobs where user_id = v_request.owner_id;
    if v_encrypted_record is null then raise exception 'recovery material is incomplete'; end if;
    update public.release_requests
       set recovery_encrypted_record = v_encrypted_record
     where id = p_request_id;
  end if;

  select jsonb_build_object(
    'request_id', v_request.id,
    'gate_envelope', jsonb_build_object(
      'ciphertext', e.ciphertext,
      'ephemeralPub', e.ephemeral_pub,
      'instructionsCiphertext', e.instructions_ciphertext,
      'instructionsEphemeralPub', e.instructions_ephemeral_pub
    ),
    'released_shares', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'keyHolderId', s.key_holder_id,
        'ciphertext', s.ciphertext,
        'ephemeralPub', s.ephemeral_pub,
        'commitment', k.share_commitment
      ) order by s.released_at), '[]'::jsonb)
        from public.release_share_releases s
        join public.key_shares k
          on k.key_holder_id = s.key_holder_id
         and k.generation_id = v_request.circle_generation_id
       where s.release_request_id = v_request.id
    ),
    'encrypted_record', v_encrypted_record
  ) into v_result
    from public.recipient_gate_envelopes e
   where e.generation_id = v_generation
     and e.recipient_holder_id = v_request.recipient_holder_id;

  if v_result is null then raise exception 'recovery material is incomplete'; end if;
  return v_result;
end;
$$;

grant execute on function public.get_ready_recovery_material(uuid) to authenticated;

-- If a structurally valid envelope still fails recipient-side authenticated
-- decryption, exclude that holder and resume collection instead of leaving
-- the recovery permanently stuck after the hold.
create or replace function public.report_invalid_recovery_support(
  p_request_id uuid,
  p_key_holder_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.release_requests%rowtype;
begin
  select * into v_request from public.release_requests
   where id = p_request_id and nominee_user_id = auth.uid() for update;
  if v_request.id is null or v_request.state <> 'ready_to_recover' then
    raise exception 'ready recovery request not found';
  end if;
  if p_key_holder_id = v_request.recipient_holder_id then
    raise exception 'recipient key cannot be reported as supporting material';
  end if;

  delete from public.release_share_releases
   where release_request_id = p_request_id and key_holder_id = p_key_holder_id;
  if not found then raise exception 'supporting material not found'; end if;

  insert into public.recovery_support_refusals (release_request_id, key_holder_id, reason)
  values (p_request_id, p_key_holder_id, 'recipient_authenticated_decryption_failed')
  on conflict (release_request_id, key_holder_id) do update
    set reason = excluded.reason, refused_at = now();

  update public.release_requests
     set state = 'collecting_support', ready_at = null
   where id = p_request_id;

  insert into public.email_deliveries (
    purpose, related_holder_id, related_request_id, recipient_email,
    idempotency_key, attempt
  )
  select 'recovery_support', h.id, p_request_id, h.holder_email,
         'recovery-support:' || p_request_id::text || ':' || h.id::text || ':retry:' || gen_random_uuid()::text,
         coalesce((
           select max(d.attempt) from public.email_deliveries d
            where d.related_request_id = p_request_id
              and d.related_holder_id = h.id
              and d.purpose = 'recovery_support'
         ), 0) + 1
    from public.key_holders h
   where h.owner_id = v_request.owner_id
     and h.status = 'verified'
     and h.id <> v_request.recipient_holder_id
     and not exists (
       select 1 from public.release_share_releases s
        where s.release_request_id = p_request_id and s.key_holder_id = h.id
     )
     and not exists (
       select 1 from public.recovery_support_refusals f
        where f.release_request_id = p_request_id and f.key_holder_id = h.id
     );
end;
$$;

grant execute on function public.report_invalid_recovery_support(uuid, uuid) to authenticated;

create or replace function public.mark_recipient_recovery_opened(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  update public.release_requests
     set state = 'opened', completed_at = coalesce(completed_at, now())
   where id = p_request_id
     and nominee_user_id = auth.uid()
     and state = 'ready_to_recover'
  returning owner_id into v_owner;
  if v_owner is null then raise exception 'ready recovery request not found'; end if;

  insert into public.audit_log (user_id, event_type, event_meta)
  values (v_owner, 'recipient_recovery_opened', jsonb_build_object('request_id', p_request_id));
end;
$$;

grant execute on function public.mark_recipient_recovery_opened(uuid) to authenticated;

-- Keep reviewer, owner-abort, and hold RPC names stable for the existing
-- clients while enforcing the new state machine for new requests.
drop function if exists public.admin_list_pending_releases();
create function public.admin_list_pending_releases()
returns table (
  id uuid,
  owner_id uuid,
  owner_email text,
  nominee_user_id uuid,
  nominee_email_at_request text,
  death_certificate_path text,
  state text,
  created_at timestamptz,
  reviewed_at timestamptz,
  rejection_reason text,
  request_kind text,
  fallback_reason text,
  evidence_summary text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
begin
  select raw_app_meta_data->>'role' into v_role from auth.users where id = v_caller;
  if v_caller is null or coalesce(v_role, '') <> 'admin' then raise exception 'not authorized'; end if;

  return query
    select r.id, r.owner_id, ou.email::text, r.nominee_user_id,
           r.nominee_email_at_request, r.death_certificate_path, r.state,
           r.created_at, r.reviewed_at, r.rejection_reason,
           r.request_kind, r.fallback_reason, r.evidence_summary
      from public.release_requests r
      join auth.users ou on ou.id = r.owner_id
     where r.state in (
       'under_review', 'collecting_support', 'holding', 'ready_to_recover',
       'pending_review', 'approved', 'awaiting_shares', 'ready_to_release'
     )
     order by r.created_at desc;
end;
$$;

create or replace function public.admin_approve_release(p_request_id uuid, p_admin_note text default null)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
begin
  select coalesce((raw_app_meta_data->>'role') = 'admin', false)
    into v_is_admin from auth.users where id = v_caller;
  if v_caller is null or not coalesce(v_is_admin, false) then raise exception 'not authorized'; end if;

  update public.release_requests
     set state = case when state = 'under_review' then 'collecting_support' else 'approved' end,
         approved_at = now(), approved_by = v_caller, reviewed_at = now()
   where id = p_request_id and state in ('under_review', 'pending_review');
  if not found then raise exception 'request is not under review'; end if;

  insert into public.email_deliveries (
    purpose, related_holder_id, related_request_id, recipient_email, idempotency_key
  )
  select 'recovery_support', h.id, r.id, h.holder_email,
         'recovery-support:' || r.id::text || ':' || h.id::text
    from public.release_requests r
    join public.key_holders h on h.owner_id = r.owner_id
   where r.id = p_request_id
     and r.recipient_holder_id is not null
     and r.state = 'collecting_support'
     and h.status = 'verified'
     and h.id <> r.recipient_holder_id
  on conflict (idempotency_key) do nothing;

  insert into public.email_deliveries (
    purpose, related_request_id, recipient_email, idempotency_key
  )
  select 'owner_alert', r.id, u.email::text, 'owner-recovery-approved:' || r.id::text
    from public.release_requests r
    join auth.users u on u.id = r.owner_id
   where r.id = p_request_id
     and r.recipient_holder_id is not null
     and r.state = 'collecting_support'
  on conflict (idempotency_key) do nothing;

  insert into public.audit_log (user_id, event_type, event_meta)
    select owner_id, 'release_approved', jsonb_build_object('request_id', p_request_id, 'note', p_admin_note)
      from public.release_requests where id = p_request_id;
end;
$$;

create or replace function public.admin_reject_release(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_is_admin boolean;
begin
  select coalesce((raw_app_meta_data->>'role') = 'admin', false)
    into v_is_admin from auth.users where id = v_caller;
  if v_caller is null or not coalesce(v_is_admin, false) then raise exception 'not authorized'; end if;
  if coalesce(length(trim(p_reason)), 0) = 0 then raise exception 'rejection reason is required'; end if;

  update public.release_requests
     set state = 'rejected', rejection_reason = trim(p_reason), reviewed_at = now()
   where id = p_request_id and state in ('under_review', 'pending_review');
  if not found then raise exception 'request is not under review'; end if;
end;
$$;

create or replace function public.admin_get_certificate_url(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_path text;
begin
  if v_caller is null or not exists (
    select 1 from auth.users
     where id = v_caller and coalesce(raw_app_meta_data->>'role', '') = 'admin'
  ) then raise exception 'not authorized'; end if;

  select death_certificate_path into v_path
    from public.release_requests where id = p_request_id;
  return v_path;
end;
$$;

create or replace function public.owner_abort_release(p_request_id uuid, p_reason text default 'owner_abort')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_state text;
  v_recipient uuid;
begin
  select state, recipient_holder_id into v_state, v_recipient from public.release_requests
   where id = p_request_id and owner_id = v_caller for update;
  if v_state is null then raise exception 'request not found'; end if;
  if v_state not in (
    'under_review', 'collecting_support', 'holding', 'ready_to_recover',
    'pending_review', 'approved', 'awaiting_shares'
  ) then raise exception 'release can no longer be aborted (state: %)', v_state; end if;

  update public.release_requests
     set state = case when v_recipient is not null then 'aborted' else 'cancelled' end,
         cancelled_at = now(), cancel_reason = p_reason
   where id = p_request_id;
end;
$$;

create or replace function public.maybe_complete_hold(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ready timestamptz;
  v_kind text;
begin
  select ready_at, case when recipient_holder_id is null then 'legacy' else 'recipient_gated' end
    into v_ready, v_kind
    from public.release_requests
   where id = p_request_id and state = 'holding'
   for update;
  if v_ready is null or v_ready > now() then return; end if;

  update public.release_requests
     set state = case when v_kind = 'recipient_gated' then 'ready_to_recover' else 'ready_to_release' end
   where id = p_request_id and state = 'holding';
end;
$$;

grant execute on function public.admin_approve_release(uuid, text) to authenticated;
grant execute on function public.admin_reject_release(uuid, text) to authenticated;
grant execute on function public.admin_get_certificate_url(uuid) to authenticated;
grant execute on function public.owner_abort_release(uuid, text) to authenticated;
grant execute on function public.maybe_complete_hold(uuid) to authenticated;

-- Reconcile provider events both from the webhook and immediately after a
-- sender persists its provider message id. This closes the fast-webhook race:
-- an event received first stays in email_delivery_events and is replayed.
create or replace function public.apply_email_delivery_events(p_provider_message_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery uuid;
  v_event record;
  v_next text;
begin
  select id into v_delivery from public.email_deliveries
   where provider_message_id = p_provider_message_id for update;
  if v_delivery is null then return false; end if;

  for v_event in
    select event_type, payload, occurred_at
      from public.email_delivery_events
     where provider_message_id = p_provider_message_id
     order by received_at asc, event_id asc
  loop
    v_next := case v_event.event_type
      when 'email.sent' then 'sent'
      when 'email.delivered' then 'delivered'
      when 'email.delivery_delayed' then 'delayed'
      when 'email.bounced' then 'bounced'
      when 'email.suppressed' then 'suppressed'
      when 'email.failed' then 'failed'
      else null
    end;
    if v_next is null then continue; end if;

    update public.email_deliveries
       set state = v_next,
           delivered_at = case when v_next = 'delivered' then coalesce(v_event.occurred_at, now()) else delivered_at end,
           failure_reason = case when v_next in ('failed', 'bounced', 'suppressed')
             then coalesce(v_event.payload #>> '{data,bounce,message}', v_event.payload #>> '{data,reason}', v_next)
             else failure_reason end,
           updated_at = now()
     where id = v_delivery
       and (
         (v_next = 'sent' and state in ('queued', 'sent'))
         or (v_next = 'delivered' and state in ('queued', 'sent', 'delayed', 'delivered'))
         or (v_next = 'delayed' and state in ('queued', 'sent', 'delayed'))
         or (v_next = 'bounced' and state in ('queued', 'sent', 'delayed', 'delivered', 'bounced'))
         or (v_next = 'suppressed' and state in ('queued', 'sent', 'delayed', 'suppressed'))
         or (v_next = 'failed' and state in ('queued', 'sent', 'delayed', 'failed'))
       );
  end loop;
  return true;
end;
$$;

revoke all on function public.apply_email_delivery_events(text) from public;
grant execute on function public.apply_email_delivery_events(text) to service_role;

do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'lyfos-invite-email-outbox';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;

select cron.schedule(
  'lyfos-invite-email-outbox',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/send-key-holder-invite'),
      headers := jsonb_build_object(
        'Authorization', concat('Bearer ', current_setting('app.settings.cron_bearer', true)),
        'content-type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- Durable outbox dispatcher. The same server-only cron bearer used by
-- the existing scheduled functions lets the Edge Function drain any
-- queued recovery email even if the admin closes their browser.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'lyfos-recovery-notification-outbox';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;

select cron.schedule(
  'lyfos-recovery-notification-outbox',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/send-recovery-notifications'),
      headers := jsonb_build_object(
        'Authorization', concat('Bearer ', current_setting('app.settings.cron_bearer', true)),
        'content-type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
