-- Row Level Security policies. Without these, ANY authenticated user
-- could read any other user's encrypted blob. The blob is still cipher-
-- text, but the metadata (size, KDF params, timestamp) would leak.
--
-- Rule: a user can only see / modify rows where user_id = auth.uid().
-- The Postgres role anon (used by the public anon key) has NO access.

-- ============================================================
-- vault_blobs
-- ============================================================
alter table public.vault_blobs enable row level security;

drop policy if exists "users read own vault" on public.vault_blobs;
create policy "users read own vault"
  on public.vault_blobs for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own vault" on public.vault_blobs;
create policy "users insert own vault"
  on public.vault_blobs for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own vault" on public.vault_blobs;
create policy "users update own vault"
  on public.vault_blobs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users delete own vault" on public.vault_blobs;
create policy "users delete own vault"
  on public.vault_blobs for delete
  using (auth.uid() = user_id);

-- ============================================================
-- devices
-- ============================================================
alter table public.devices enable row level security;

drop policy if exists "users read own devices" on public.devices;
create policy "users read own devices"
  on public.devices for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own devices" on public.devices;
create policy "users insert own devices"
  on public.devices for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own devices" on public.devices;
create policy "users update own devices"
  on public.devices for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users delete own devices" on public.devices;
create policy "users delete own devices"
  on public.devices for delete
  using (auth.uid() = user_id);

-- ============================================================
-- recovery_envelopes
-- ============================================================
alter table public.recovery_envelopes enable row level security;

drop policy if exists "users read own recovery" on public.recovery_envelopes;
create policy "users read own recovery"
  on public.recovery_envelopes for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own recovery" on public.recovery_envelopes;
create policy "users insert own recovery"
  on public.recovery_envelopes for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own recovery" on public.recovery_envelopes;
create policy "users update own recovery"
  on public.recovery_envelopes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users delete own recovery" on public.recovery_envelopes;
create policy "users delete own recovery"
  on public.recovery_envelopes for delete
  using (auth.uid() = user_id);

-- ============================================================
-- audit_log
-- Read-only from the client. Writes go through a Postgres function
-- (or server-side edge function) so the client can't fabricate events.
-- ============================================================
alter table public.audit_log enable row level security;

drop policy if exists "users read own audit" on public.audit_log;
create policy "users read own audit"
  on public.audit_log for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies for the client. Inserts must come
-- via a SECURITY DEFINER function or server-side context.

-- ============================================================
-- audit insert helper
-- Lets the client log security events about itself without being
-- able to forge events for other users.
-- ============================================================
create or replace function public.append_audit_event(
  p_event_type text,
  p_event_meta jsonb,
  p_device_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.audit_log (user_id, event_type, event_meta, device_token)
  values (auth.uid(), p_event_type, p_event_meta, p_device_token);
end;
$$;

grant execute on function public.append_audit_event(text, jsonb, text) to authenticated;
