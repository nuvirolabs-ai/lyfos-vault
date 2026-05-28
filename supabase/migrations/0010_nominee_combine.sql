-- Lyfos — nominee combine + complete the release.
--
-- After the 14-day hold expires AND ≥3 shares are released, the
-- nominee needs to:
--   1. Read the owner's vault_blobs row (just the encrypted blob —
--      she still has to combine SSS shares + decrypt to make sense
--      of it)
--   2. Mark the release_request as 'completed'
--
-- Both bridged through SECURITY DEFINER RPCs.

create or replace function public.nominee_get_vault_blob(p_request_id uuid)
returns table (
  encrypted_record  jsonb,
  version           integer,
  size_bytes        integer,
  client_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
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
  if v_state not in ('ready_to_release','completed') then
    raise exception 'release is not ready (state: %)', v_state;
  end if;

  if not exists (
    select 1 from public.release_requests
    where id = p_request_id and nominee_user_id = v_caller
  ) then
    raise exception 'not your request';
  end if;

  return query
    select vb.encrypted_record, vb.version, vb.size_bytes, vb.client_updated_at
      from public.vault_blobs vb
      where vb.user_id = v_owner;
end;
$$;
grant execute on function public.nominee_get_vault_blob(uuid) to authenticated;

create or replace function public.nominee_mark_completed(p_request_id uuid)
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
    from public.release_requests where id = p_request_id for update;
  if v_owner is null then raise exception 'request not found'; end if;
  if v_state <> 'ready_to_release' then
    raise exception 'request is not ready_to_release (state: %)', v_state;
  end if;
  if not exists (
    select 1 from public.release_requests
    where id = p_request_id and nominee_user_id = v_caller
  ) then
    raise exception 'not your request';
  end if;

  update public.release_requests
     set state = 'completed', completed_at = now()
   where id = p_request_id;

  insert into public.audit_log (user_id, event_type, event_meta)
    values (v_owner, 'release_completed', jsonb_build_object('request_id', p_request_id, 'nominee_user_id', v_caller));
end;
$$;
grant execute on function public.nominee_mark_completed(uuid) to authenticated;
