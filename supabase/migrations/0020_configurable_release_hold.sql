-- Make the release hold duration configurable for controlled live testing.
-- Default remains 14 days unless app.settings.release_hold_interval is set.

create table if not exists public.app_runtime_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

revoke all on public.app_runtime_settings from anon, authenticated;

create or replace function public.touch_release_ready_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold_text text;
  v_hold interval;
begin
  select value into v_hold_text
    from public.app_runtime_settings
   where key = 'release_hold_interval';

  v_hold := coalesce(nullif(v_hold_text, ''), '14 days')::interval;

  if new.state = 'holding' and (old.state is null or old.state <> 'holding') then
    new.hold_started_at = coalesce(new.hold_started_at, now());
    new.ready_at = new.hold_started_at + v_hold;
  end if;
  return new;
end;
$$;

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

    -- In normal mode this is a no-op until ready_at has passed.
    -- In testing mode, a zero hold immediately advances the request.
    perform public.maybe_complete_hold(p_request_id);
  end if;
end;
$$;

grant execute on function public.maybe_start_hold(uuid) to authenticated;
