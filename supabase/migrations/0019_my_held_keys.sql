-- Let a signed-in trusted nominee/key holder see the vault-owner
-- relationships they accepted, without granting direct auth.users access.

create or replace function public.my_held_keys()
returns table (
  id uuid,
  owner_id uuid,
  owner_email text,
  holder_email text,
  label text,
  status text,
  release_pubkey text,
  created_at timestamptz,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    h.id,
    h.owner_id,
    u.email::text as owner_email,
    h.holder_email,
    h.label,
    h.status,
    h.release_pubkey,
    h.created_at,
    h.accepted_at
  from public.key_holders h
  join auth.users u on u.id = h.owner_id
  where h.holder_user_id = auth.uid()
    and h.status <> 'revoked'
  order by h.created_at desc;
$$;

grant execute on function public.my_held_keys() to authenticated;
