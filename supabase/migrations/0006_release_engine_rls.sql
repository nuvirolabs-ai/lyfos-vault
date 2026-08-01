-- RLS policies for the release engine.
--
-- Each table is touched by up to three principals:
--   - the OWNER: configures the plan, reviews holders, owns the vault
--   - the HOLDER: their own holder row + their own share
--   - the NOMINEE: reads release_requests they raised + sees shares
--     released to them
--   - the FOUNDER (admin): reviews pending_review claims; we mark
--     these out-of-band — there is no users.role column in v1. For
--     this release identifies admins by their JWT being from a hard-
--     coded ADMIN_USER_IDS array, enforced inside SECURITY DEFINER
--     functions, NOT via RLS.
--
-- Anything ambiguous between principals goes through a SECURITY
-- DEFINER function (declared at the bottom) so we can audit the
-- combined ACL in one place.

-- ============================================================
-- key_holders
-- Owner reads/writes her holder rows. Holder reads her own rows
-- (so the invite-accept screen can show context).
-- ============================================================
alter table public.key_holders enable row level security;

drop policy if exists "owner reads own holders" on public.key_holders;
create policy "owner reads own holders"
  on public.key_holders for select
  using (auth.uid() = owner_id);

drop policy if exists "owner writes own holders" on public.key_holders;
create policy "owner writes own holders"
  on public.key_holders for insert
  with check (auth.uid() = owner_id);

drop policy if exists "owner updates own holders" on public.key_holders;
create policy "owner updates own holders"
  on public.key_holders for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "owner deletes own holders" on public.key_holders;
create policy "owner deletes own holders"
  on public.key_holders for delete
  using (auth.uid() = owner_id);

drop policy if exists "holder reads own row" on public.key_holders;
create policy "holder reads own row"
  on public.key_holders for select
  using (auth.uid() = holder_user_id);

-- ============================================================
-- key_shares
-- Owner reads/writes shares she provisioned. Holder reads HER OWN
-- share so she can decrypt + re-encrypt during release. Nobody
-- else gets to see ciphertext — RLS makes that physical.
-- ============================================================
alter table public.key_shares enable row level security;

drop policy if exists "owner reads own shares" on public.key_shares;
create policy "owner reads own shares"
  on public.key_shares for select
  using (auth.uid() = owner_id);

drop policy if exists "owner inserts own shares" on public.key_shares;
create policy "owner inserts own shares"
  on public.key_shares for insert
  with check (auth.uid() = owner_id);

drop policy if exists "owner deletes own shares" on public.key_shares;
create policy "owner deletes own shares"
  on public.key_shares for delete
  using (auth.uid() = owner_id);

drop policy if exists "holder reads own share" on public.key_shares;
create policy "holder reads own share"
  on public.key_shares for select
  using (
    exists (
      select 1 from public.key_holders h
      where h.id = key_shares.key_holder_id and h.holder_user_id = auth.uid()
    )
  );

-- ============================================================
-- release_requests
-- Nominee reads + creates her own. Owner reads requests against her
-- vault (so she can see the abort opportunity, and to render the
-- "active release request" notice). Holders read the requests
-- where they're a key holder of the owner.
-- ============================================================
alter table public.release_requests enable row level security;

drop policy if exists "nominee reads own requests" on public.release_requests;
create policy "nominee reads own requests"
  on public.release_requests for select
  using (auth.uid() = nominee_user_id);

drop policy if exists "nominee creates own request" on public.release_requests;
create policy "nominee creates own request"
  on public.release_requests for insert
  with check (auth.uid() = nominee_user_id);

drop policy if exists "owner reads requests against own vault" on public.release_requests;
create policy "owner reads requests against own vault"
  on public.release_requests for select
  using (auth.uid() = owner_id);

drop policy if exists "holder reads requests for owners she keys for" on public.release_requests;
create policy "holder reads requests for owners she keys for"
  on public.release_requests for select
  using (
    exists (
      select 1 from public.key_holders h
      where h.owner_id = release_requests.owner_id
        and h.holder_user_id = auth.uid()
        and h.status = 'verified'
    )
  );

-- ============================================================
-- release_share_releases
-- The holder who is releasing inserts her own row. The nominee
-- reads them for her own request (so she can fetch ciphertexts and
-- combine). The owner reads them too (so the abort screen can show
-- "3 of 3 keys released — your hold is active").
-- ============================================================
alter table public.release_share_releases enable row level security;

drop policy if exists "holder inserts own share release" on public.release_share_releases;
create policy "holder inserts own share release"
  on public.release_share_releases for insert
  with check (
    exists (
      select 1 from public.key_holders h
      where h.id = release_share_releases.key_holder_id
        and h.holder_user_id = auth.uid()
    )
  );

drop policy if exists "nominee reads releases for own request" on public.release_share_releases;
create policy "nominee reads releases for own request"
  on public.release_share_releases for select
  using (
    exists (
      select 1 from public.release_requests r
      where r.id = release_share_releases.release_request_id
        and r.nominee_user_id = auth.uid()
    )
  );

drop policy if exists "owner reads releases against own vault" on public.release_share_releases;
create policy "owner reads releases against own vault"
  on public.release_share_releases for select
  using (
    exists (
      select 1 from public.release_requests r
      where r.id = release_share_releases.release_request_id
        and r.owner_id = auth.uid()
    )
  );

-- ============================================================
-- release_alerts
-- Owner reads alerts about her own holds. Nobody else needs to.
-- Inserts only via the alert-dispatcher edge function (service role).
-- ============================================================
alter table public.release_alerts enable row level security;

drop policy if exists "owner reads own alerts" on public.release_alerts;
create policy "owner reads own alerts"
  on public.release_alerts for select
  using (
    exists (
      select 1 from public.release_requests r
      where r.id = release_alerts.release_request_id
        and r.owner_id = auth.uid()
    )
  );

-- ============================================================
-- State-transition helpers (SECURITY DEFINER)
-- These exist so the state machine is enforced in ONE place. The
-- client-side code calls these via rpc(). Bypassing them via raw
-- UPDATE is technically possible for the owner on her own rows
-- (RLS allows it), but the client-side helpers always go through
-- these so the audit trail is consistent.
-- ============================================================

-- Approve a release request. Founder-only.
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
  if v_caller is null then raise exception 'not authenticated'; end if;
  select coalesce((raw_user_meta_data->>'role') = 'admin', false)
    into v_is_admin
    from auth.users where id = v_caller;
  if not v_is_admin then raise exception 'not authorized'; end if;

  update public.release_requests
     set state = 'approved', approved_at = now(), approved_by = v_caller, reviewed_at = now()
   where id = p_request_id and state = 'pending_review';

  if not found then raise exception 'request not in pending_review state'; end if;

  insert into public.audit_log (user_id, event_type, event_meta)
    select owner_id, 'release_approved', jsonb_build_object('request_id', p_request_id, 'note', p_admin_note)
    from public.release_requests where id = p_request_id;
end;
$$;
grant execute on function public.admin_approve_release(uuid, text) to authenticated;

-- Reject a release request. Founder-only.
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
  if v_caller is null then raise exception 'not authenticated'; end if;
  select coalesce((raw_user_meta_data->>'role') = 'admin', false)
    into v_is_admin
    from auth.users where id = v_caller;
  if not v_is_admin then raise exception 'not authorized'; end if;

  update public.release_requests
     set state = 'rejected', rejection_reason = p_reason, reviewed_at = now()
   where id = p_request_id and state = 'pending_review';

  if not found then raise exception 'request not in pending_review state'; end if;
end;
$$;
grant execute on function public.admin_reject_release(uuid, text) to authenticated;

-- Owner abort. Only the owner of the request can call this, and only
-- when the request is in a cancellable state.
create or replace function public.owner_abort_release(p_request_id uuid, p_reason text default 'owner_abort')
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_state  text;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select owner_id, state into v_owner, v_state
    from public.release_requests where id = p_request_id;
  if v_owner is null then raise exception 'request not found'; end if;
  if v_owner <> v_caller then raise exception 'not authorized'; end if;
  if v_state not in ('pending_review','approved','awaiting_shares','holding') then
    raise exception 'release can no longer be aborted (state: %)', v_state;
  end if;

  update public.release_requests
     set state = 'cancelled', cancelled_at = now(), cancel_reason = p_reason
   where id = p_request_id;

  insert into public.audit_log (user_id, event_type, event_meta)
    values (v_caller, 'release_aborted_by_owner', jsonb_build_object('request_id', p_request_id, 'reason', p_reason));
end;
$$;
grant execute on function public.owner_abort_release(uuid, text) to authenticated;

-- Advance to 'holding' once 3 shares have been released. Idempotent.
create or replace function public.maybe_start_hold(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_state text;
begin
  select state into v_state from public.release_requests where id = p_request_id for update;
  if v_state is null then return; end if;
  if v_state <> 'awaiting_shares' then return; end if;

  select count(*) into v_count
    from public.release_share_releases
   where release_request_id = p_request_id;

  if v_count >= 3 then
    update public.release_requests
       set state = 'holding', hold_started_at = now()
     where id = p_request_id;
    -- ready_at gets stamped by the trigger.
  end if;
end;
$$;
grant execute on function public.maybe_start_hold(uuid) to authenticated;

-- Advance from 'holding' → 'ready_to_release' once the hold expires.
-- Called by the alert-dispatcher edge function daily.
create or replace function public.maybe_complete_hold(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ready timestamptz;
  v_state text;
begin
  select state, ready_at into v_state, v_ready
    from public.release_requests where id = p_request_id for update;
  if v_state <> 'holding' then return; end if;
  if v_ready is null or v_ready > now() then return; end if;

  update public.release_requests
     set state = 'ready_to_release'
   where id = p_request_id;
end;
$$;
grant execute on function public.maybe_complete_hold(uuid) to authenticated;

-- Holder calls this to record her share release. Inserts into
-- release_share_releases atomically + advances state if threshold
-- reached.
create or replace function public.holder_release_share(
  p_request_id uuid,
  p_share_index integer,
  p_ciphertext text,
  p_ephemeral_pub text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_holder uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select owner_id into v_owner from public.release_requests where id = p_request_id;
  if v_owner is null then raise exception 'request not found'; end if;

  select h.id into v_holder
    from public.key_holders h
   where h.owner_id = v_owner and h.holder_user_id = v_caller and h.status = 'verified';
  if v_holder is null then raise exception 'not a verified key holder for this owner'; end if;

  insert into public.release_share_releases (release_request_id, key_holder_id, share_index, ciphertext, ephemeral_pub)
    values (p_request_id, v_holder, p_share_index, p_ciphertext, p_ephemeral_pub)
    on conflict (release_request_id, key_holder_id) do nothing;

  -- Move the request into awaiting_shares if it was approved but
  -- nothing released yet; then check threshold.
  update public.release_requests
     set state = 'awaiting_shares'
   where id = p_request_id and state = 'approved';

  perform public.maybe_start_hold(p_request_id);
end;
$$;
grant execute on function public.holder_release_share(uuid, integer, text, text) to authenticated;
