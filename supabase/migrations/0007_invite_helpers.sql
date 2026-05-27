-- Lyfos invite helpers.
--
-- Two SECURITY DEFINER functions that bridge the public invite link
-- and the authenticated accept flow without leaking the whole
-- key_holders table.
--
--   peek_invite(token)  → public: anyone with the token sees enough
--                         context to decide whether to accept
--   accept_invite(token, release_pubkey)
--                       → authenticated: must be signed in, email
--                         must match the invite's holder_email,
--                         flips status pending → accepted and stamps
--                         the release_pubkey
--   finalize_release_plan(holder_id_to_share)
--                       → owner-only: bulk-mark holders as verified
--                         after the owner has uploaded all 5 shares
--                         (the actual key_shares inserts are done by
--                         the client under owner RLS — this RPC just
--                         flips the status atomically)

-- ============================================================
-- peek_invite — public, returns minimal context
-- ============================================================
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
      u.email,         -- owner's email so the holder can confirm who invited her
      h.label,
      h.holder_email,
      h.status,
      h.created_at
    from public.key_holders h
    join auth.users u on u.id = h.owner_id
    where h.invite_token = p_token
      and h.status in ('pending','accepted','verified')   -- revoked invites: empty result
    limit 1;
end;
$$;

-- Anonymous (anon) callers can call this. The function returns at most
-- one row and only safe-to-show fields. We don't expose owner_id or any
-- secrets.
grant execute on function public.peek_invite(text) to anon, authenticated;

-- ============================================================
-- accept_invite — authenticated, email-match enforced
-- ============================================================
create or replace function public.accept_invite(p_token text, p_release_pubkey text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_id    uuid := auth.uid();
  v_caller_email text;
  v_holder_id    uuid;
  v_holder_email text;
  v_status       text;
begin
  if v_caller_id is null then raise exception 'not authenticated'; end if;
  if p_release_pubkey is null or length(p_release_pubkey) < 32 then
    raise exception 'release_pubkey must be a base64 Curve25519 public key';
  end if;

  select email into v_caller_email from auth.users where id = v_caller_id;
  if v_caller_email is null then raise exception 'caller email not found'; end if;

  select id, holder_email, status into v_holder_id, v_holder_email, v_status
    from public.key_holders
   where invite_token = p_token
   for update;

  if v_holder_id is null then raise exception 'invite not found'; end if;
  if v_status = 'revoked' then raise exception 'invite has been revoked'; end if;
  if lower(v_caller_email) <> lower(v_holder_email) then
    raise exception 'sign in with the email this invite was sent to';
  end if;

  update public.key_holders
     set holder_user_id = v_caller_id,
         release_pubkey = p_release_pubkey,
         status         = case when status = 'verified' then 'verified' else 'accepted' end,
         accepted_at    = coalesce(accepted_at, now())
   where id = v_holder_id;

  insert into public.audit_log (user_id, event_type, event_meta)
    values (v_caller_id, 'invite_accepted', jsonb_build_object('invite_id', v_holder_id));

  return v_holder_id;
end;
$$;

grant execute on function public.accept_invite(text, text) to authenticated;

-- ============================================================
-- mark_holder_verified — owner-only, called per holder after the
-- corresponding key_shares row has been inserted
-- ============================================================
create or replace function public.mark_holder_verified(p_holder_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_status text;
  v_shares int;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  select owner_id, status into v_owner, v_status
    from public.key_holders where id = p_holder_id for update;
  if v_owner is null then raise exception 'holder not found'; end if;
  if v_owner <> v_caller then raise exception 'not your holder'; end if;
  if v_status <> 'accepted' then
    raise exception 'holder must be in accepted state (currently: %)', v_status;
  end if;

  -- Belt-and-braces check that a share row actually exists for this
  -- holder — protects against the owner marking verified without
  -- actually provisioning the share.
  select count(*) into v_shares from public.key_shares where key_holder_id = p_holder_id;
  if v_shares = 0 then
    raise exception 'cannot mark verified before key_shares row exists';
  end if;

  update public.key_holders
     set status = 'verified', verified_at = now()
   where id = p_holder_id;
end;
$$;
grant execute on function public.mark_holder_verified(uuid) to authenticated;
