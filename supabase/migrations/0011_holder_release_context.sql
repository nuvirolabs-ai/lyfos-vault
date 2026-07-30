-- Return the minimum non-secret context a verified key holder needs while
-- helping release someone else's vault. Emails and encrypted share material
-- stay outside this response.
create or replace function public.holder_release_context(p_request_id uuid)
returns table (
  owner_id uuid,
  holder_id uuid,
  holder_label text,
  holder_status text,
  share_released boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_owner uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select r.owner_id into v_owner
    from public.release_requests r
   where r.id = p_request_id;
  if v_owner is null then raise exception 'request not found'; end if;

  if not exists (
    select 1 from public.key_holders h
     where h.owner_id = v_owner
       and h.holder_user_id = v_caller
       and h.status = 'verified'
  ) then
    raise exception 'not a verified key holder for this owner';
  end if;

  return query
    select v_owner,
           h.id,
           h.label,
           h.status,
           exists (
             select 1
               from public.release_share_releases s
              where s.release_request_id = p_request_id
                and s.key_holder_id = h.id
           )
      from public.key_holders h
     where h.owner_id = v_owner
       and h.status <> 'revoked'
     order by h.created_at asc;
end;
$$;

grant execute on function public.holder_release_context(uuid) to authenticated;
