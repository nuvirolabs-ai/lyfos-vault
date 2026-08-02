-- 0017_waitlist_activation.sql
-- Adds approval/activation tracking to the founding-members waitlist so the
-- founder can grant access in batches and trigger an activation email.
--
-- Flow: a signup lands as 'pending'. The founder activates it from the admin
-- page (see apps/marketing/admin/), which calls the `waitlist-admin` Edge
-- Function with the service role — that sets status='activated', stamps
-- activated_at, and emails the person their private app link.
--
-- RLS stays fully locked (no anon policies); only the service-role functions
-- (`waitlist`, `waitlist-admin`) read or write this table.

alter table public.waitlist
  add column if not exists status       text not null default 'pending',
  add column if not exists activated_at timestamptz,
  add column if not exists note         text;

-- Constrain status to the two states we support.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'waitlist_status_check'
  ) then
    alter table public.waitlist
      add constraint waitlist_status_check check (status in ('pending', 'activated'));
  end if;
end $$;

-- Fast listing in the admin page (pending first, oldest first).
create index if not exists waitlist_status_idx on public.waitlist (status, created_at);

comment on column public.waitlist.status is
  'pending | activated — set to activated by the waitlist-admin Edge Function when the founder grants access.';
comment on column public.waitlist.activated_at is
  'When the founder activated this signup (and the activation email was sent).';
comment on column public.waitlist.note is
  'Optional free-text note the founder can attach to a signup from the admin page.';
