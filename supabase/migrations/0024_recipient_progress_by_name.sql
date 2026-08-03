-- The nominee-facing recovery screen only showed aggregate counts
-- (approved/refused/waiting). Nominees asked to see who, by name and
-- role, is involved and their live status, rather than bare numbers.
--
-- This does not change the recovery threshold logic (still any 2 of
-- the remaining verified holders) — it only exposes identity + status
-- for the holders already visible to each other as members of the
-- same circle of trust.

create or replace function public.recipient_recovery_progress_detailed(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_request public.release_requests%rowtype;
  v_recipient public.key_holders%rowtype;
  v_supporters jsonb;
begin
  select * into v_request from public.release_requests
   where id = p_request_id and nominee_user_id = auth.uid();
  if v_request.id is null then raise exception 'recovery request not found'; end if;

  select * into v_recipient from public.key_holders where id = v_request.recipient_holder_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'label', h.label,
    'role', h.role,
    'status', case
      when exists (
        select 1 from public.release_share_releases s
         where s.release_request_id = p_request_id and s.key_holder_id = h.id
      ) then 'approved'
      when exists (
        select 1 from public.recovery_support_refusals f
         where f.release_request_id = p_request_id and f.key_holder_id = h.id
      ) then 'refused'
      else 'waiting'
    end
  ) order by h.role, h.label), '[]'::jsonb)
  into v_supporters
  from public.key_holders h
  where h.owner_id = v_request.owner_id
    and h.status = 'verified'
    and h.id <> v_request.recipient_holder_id;

  return jsonb_build_object(
    'recipient', jsonb_build_object('label', v_recipient.label, 'role', v_recipient.role),
    'supporters', v_supporters,
    'required', 2
  );
end;
$$;

grant execute on function public.recipient_recovery_progress_detailed(uuid) to authenticated;
