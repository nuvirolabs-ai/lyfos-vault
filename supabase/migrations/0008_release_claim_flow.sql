-- Lyfos release claim flow.
--
-- Adds:
--   release_settings  — per-owner claim token the owner shares with
--                       her nominee out of band
--   peek_claim(token) — public RPC that resolves a claim_token to the
--                       owner's public-facing info, so the nominee can
--                       verify she's at the right place before signing in
--   create_release_request — secured nominee-side RPC that opens a new
--                            pending_review release_request
--   storage bucket "death_certificates" + policies
--   storage bucket "release_downloads"  + policies (Day 11-12)
--
-- A nominee never reads vault_blobs directly. She reads release_requests
-- she raised, the shares released to her, and a one-time signed download
-- URL after the hold completes.

-- ============================================================
-- release_settings: per-owner claim token + notes
-- ============================================================
create table if not exists public.release_settings (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  claim_token    text not null unique,
  claim_text     text,                          -- optional owner-written note shown to the nominee
  nominee_email  text,                          -- expected nominee email; not enforced, just shown
  nominee_label  text,                          -- "Priya Sharma (spouse)"
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists release_settings_claim_token_idx on public.release_settings (claim_token);

alter table public.release_settings enable row level security;

drop policy if exists "owner reads own release settings" on public.release_settings;
create policy "owner reads own release settings"
  on public.release_settings for select
  using (auth.uid() = user_id);

drop policy if exists "owner inserts own release settings" on public.release_settings;
create policy "owner inserts own release settings"
  on public.release_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "owner updates own release settings" on public.release_settings;
create policy "owner updates own release settings"
  on public.release_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "owner deletes own release settings" on public.release_settings;
create policy "owner deletes own release settings"
  on public.release_settings for delete
  using (auth.uid() = user_id);

drop trigger if exists release_settings_touch_updated on public.release_settings;
create trigger release_settings_touch_updated
  before update on public.release_settings
  for each row execute function public.touch_updated_at();

-- ============================================================
-- peek_claim — public, returns just enough to render the claim page
-- ============================================================
create or replace function public.peek_claim(p_token text)
returns table (
  owner_email     text,
  nominee_email   text,
  nominee_label   text,
  claim_text      text,
  plan_active     boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return query
    select
      u.email,
      rs.nominee_email,
      rs.nominee_label,
      rs.claim_text,
      coalesce(
        (select count(*) >= 5 from public.key_holders h where h.owner_id = rs.user_id and h.status = 'verified'),
        false
      ) as plan_active
    from public.release_settings rs
    join auth.users u on u.id = rs.user_id
    where rs.claim_token = p_token
    limit 1;
end;
$$;

grant execute on function public.peek_claim(text) to anon, authenticated;

-- ============================================================
-- create_release_request — secured: nominee files a new claim
--
-- Takes the claim_token (so we don't expose owner_id directly to the
-- client) + the nominee's release_process_pubkey (Curve25519, per-claim
-- fresh) + an optional storage path to the uploaded death certificate.
--
-- Inserts a release_requests row with state='pending_review'. The
-- partial unique index prevents multiple in-flight releases per owner.
-- ============================================================
create or replace function public.create_release_request(
  p_claim_token text,
  p_release_process_pubkey text,
  p_death_certificate_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_id    uuid := auth.uid();
  v_caller_email text;
  v_owner_id     uuid;
  v_plan_active  boolean;
  v_request_id   uuid;
begin
  if v_caller_id is null then raise exception 'not authenticated'; end if;
  if p_release_process_pubkey is null or length(p_release_process_pubkey) < 32 then
    raise exception 'release_process_pubkey required';
  end if;

  select email into v_caller_email from auth.users where id = v_caller_id;
  if v_caller_email is null then raise exception 'caller email not found'; end if;

  -- Resolve owner from claim_token
  select user_id into v_owner_id from public.release_settings where claim_token = p_claim_token;
  if v_owner_id is null then raise exception 'invalid claim link'; end if;
  if v_owner_id = v_caller_id then raise exception 'you cannot file a claim against your own vault'; end if;

  -- Verify the plan is actually active (5 verified holders)
  select count(*) >= 5 into v_plan_active
    from public.key_holders where owner_id = v_owner_id and status = 'verified';
  if not v_plan_active then
    raise exception 'this owner has not finalized their release plan yet';
  end if;

  -- Reject if there's already an in-flight request against this owner
  if exists (
    select 1 from public.release_requests
    where owner_id = v_owner_id
      and state in ('pending_review','approved','awaiting_shares','holding','ready_to_release')
  ) then
    raise exception 'a release request is already in flight for this vault';
  end if;

  insert into public.release_requests (
    owner_id, nominee_user_id, nominee_email_at_request,
    release_process_pubkey, death_certificate_path
  ) values (
    v_owner_id, v_caller_id, v_caller_email,
    p_release_process_pubkey, p_death_certificate_path
  )
  returning id into v_request_id;

  -- Owner-side audit log entry (the nominee can't see it, but the
  -- owner sees the new request appear in her release tab UI)
  insert into public.audit_log (user_id, event_type, event_meta)
    values (v_owner_id, 'release_claim_filed', jsonb_build_object(
      'request_id', v_request_id,
      'nominee_email', v_caller_email
    ));

  return v_request_id;
end;
$$;

grant execute on function public.create_release_request(text, text, text) to authenticated;

-- ============================================================
-- admin_list_pending_releases — founder review queue
-- Returns rows visible to the calling admin only. Not callable by
-- non-admins (raises) so we don't leak the request count.
-- ============================================================
create or replace function public.admin_list_pending_releases()
returns table (
  id                       uuid,
  owner_id                 uuid,
  owner_email              text,
  nominee_user_id          uuid,
  nominee_email_at_request text,
  death_certificate_path   text,
  state                    text,
  created_at               timestamptz,
  reviewed_at              timestamptz,
  rejection_reason         text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_role   text;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select raw_user_meta_data->>'role' into v_role from auth.users where id = v_caller;
  if coalesce(v_role, '') <> 'admin' then raise exception 'not authorized'; end if;

  return query
    select
      r.id, r.owner_id, ou.email,
      r.nominee_user_id, r.nominee_email_at_request,
      r.death_certificate_path, r.state, r.created_at,
      r.reviewed_at, r.rejection_reason
    from public.release_requests r
    join auth.users ou on ou.id = r.owner_id
    where r.state in ('pending_review','approved','awaiting_shares','holding','ready_to_release')
    order by r.created_at desc;
end;
$$;
grant execute on function public.admin_list_pending_releases() to authenticated;

-- ============================================================
-- admin_get_certificate_url — short-lived signed URL to the
-- nominee's death certificate. Admin only.
-- ============================================================
create or replace function public.admin_get_certificate_url(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, storage
as $$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_path   text;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select raw_user_meta_data->>'role' into v_role from auth.users where id = v_caller;
  if coalesce(v_role, '') <> 'admin' then raise exception 'not authorized'; end if;

  select death_certificate_path into v_path from public.release_requests where id = p_request_id;
  if v_path is null then return null; end if;

  -- Note: we do NOT actually generate a signed URL here (Postgres can't
  -- talk to Storage from inside a function). The admin client calls
  -- storage.from('death_certificates').createSignedUrl(path, 60) on the
  -- path this function returns. This function exists so the path is
  -- only readable by admins.
  return v_path;
end;
$$;
grant execute on function public.admin_get_certificate_url(uuid) to authenticated;

-- ============================================================
-- Storage buckets + policies
-- ============================================================

-- Create buckets if they don't exist. NB: insert into storage.buckets
-- requires the schema-owner; in Supabase the SQL editor runs as
-- postgres which is fine.
insert into storage.buckets (id, name, public)
  values ('death_certificates', 'death_certificates', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('release_downloads', 'release_downloads', false)
  on conflict (id) do nothing;

-- death_certificates: any authenticated user can upload (their own
-- claim), only the claim's nominee + an admin can read.
drop policy if exists "death_cert nominee upload"   on storage.objects;
drop policy if exists "death_cert nominee read"     on storage.objects;
drop policy if exists "death_cert admin read"       on storage.objects;
drop policy if exists "release_dl nominee read"     on storage.objects;
drop policy if exists "release_dl service write"    on storage.objects;

create policy "death_cert nominee upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'death_certificates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "death_cert nominee read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'death_certificates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "death_cert admin read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'death_certificates'
    and coalesce((select raw_user_meta_data->>'role' from auth.users where id = auth.uid()), '') = 'admin'
  );

create policy "release_dl nominee read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'release_downloads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
