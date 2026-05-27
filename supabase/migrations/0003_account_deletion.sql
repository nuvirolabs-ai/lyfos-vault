-- Account deletion as a single signed-in call. DPDPA Section 12 (right
-- to erasure) and GDPR Article 17.
--
-- The function runs with SECURITY DEFINER so it can touch auth.users
-- (which RLS would otherwise forbid). It deletes ONLY the rows owned
-- by the calling user — auth.uid() is verified inside the function
-- before any delete fires.
--
-- After this returns, the JWT in the client's hand becomes stateless:
-- there's no auth.users row to refresh it against, and the
-- on delete cascade on every domain table has already removed the
-- user's data. The client must clear its local session afterward.

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- Explicit deletes in case the cascade is ever weakened.
  delete from public.vault_blobs         where user_id = v_user_id;
  delete from public.devices             where user_id = v_user_id;
  delete from public.recovery_envelopes  where user_id = v_user_id;
  delete from public.audit_log           where user_id = v_user_id;

  -- Final blow: the auth.users row. Cascades remove sessions and
  -- identities. After this, no token can authenticate as this user
  -- again.
  delete from auth.users where id = v_user_id;
end;
$$;

grant execute on function public.delete_account() to authenticated;
