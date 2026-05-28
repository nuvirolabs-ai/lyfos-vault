-- Lyfos — push token registry for mobile.
--
-- Each (user, device) → at most one Expo push token. The release-alert
-- dispatcher Edge Function reads these and fans out an extra "push"
-- channel (deep-linked to /release/abort) alongside email/SMS/WhatsApp.

create table if not exists public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_token text not null,
  expo_token   text not null,
  platform     text not null,  -- 'ios' | 'android'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, device_token)
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
create index if not exists push_tokens_expo_idx on public.push_tokens (expo_token);

alter table public.push_tokens enable row level security;

drop policy if exists "user reads own push tokens"   on public.push_tokens;
drop policy if exists "user upserts own push tokens" on public.push_tokens;
drop policy if exists "user deletes own push tokens" on public.push_tokens;

create policy "user reads own push tokens"
  on public.push_tokens for select
  using (auth.uid() = user_id);

create policy "user upserts own push tokens"
  on public.push_tokens for insert
  with check (auth.uid() = user_id);

create policy "user updates own push tokens"
  on public.push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user deletes own push tokens"
  on public.push_tokens for delete
  using (auth.uid() = user_id);

drop trigger if exists push_tokens_touch_updated on public.push_tokens;
create trigger push_tokens_touch_updated
  before update on public.push_tokens
  for each row execute function public.touch_updated_at();
