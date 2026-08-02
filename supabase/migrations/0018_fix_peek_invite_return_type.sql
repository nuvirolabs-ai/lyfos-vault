-- auth.users.email is varchar in Supabase. Cast it explicitly so the
-- SECURITY DEFINER table-returning function matches its declared text type.
create or replace function public.peek_invite(p_token text)
returns table (
  invite_id       uuid,
  owner_email     text,
  holder_label    text,
  holder_email    text,
  status          text,
  created_at      timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return query
    select
      h.id,
      u.email::text,
      h.label,
      h.holder_email,
      h.status,
      h.created_at
    from public.key_holders h
    join auth.users u on u.id = h.owner_id
    where h.invite_token = p_token
      and h.status in ('pending', 'accepted', 'verified')
    limit 1;
end;
$$;

grant execute on function public.peek_invite(text) to anon, authenticated;
