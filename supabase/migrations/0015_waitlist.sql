-- 0015_waitlist.sql
-- Founding-members waitlist captured from the marketing site (apps/marketing).
-- Rows are written ONLY by the `waitlist` Edge Function using the service role;
-- RLS is enabled with no anon/authenticated policies, so the table is not
-- readable or writable by public clients directly.

create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  source      text,                 -- e.g. 'marketing-home'
  user_agent  text,
  referrer    text,
  created_at  timestamptz not null default now()
);

-- Case-insensitive uniqueness so the same address can't pile up duplicates.
create unique index if not exists waitlist_email_lower_key
  on public.waitlist (lower(email));

alter table public.waitlist enable row level security;
-- (Intentionally no policies — only the service-role Edge Function may write.)

comment on table public.waitlist is
  'Founding-members waitlist signups from the marketing site. Inserted only by the waitlist Edge Function (service role).';
