-- Lyfos coupons.
--
-- Discount codes for the one-time Vault purchase. Codes are only ever
-- read/written by Edge Functions using the service role key (RLS below
-- grants no policies to anon/authenticated), so codes can't be listed
-- or enumerated by browsing the client.
--
-- A redemption is only recorded once Razorpay confirms payment (see
-- razorpay-webhook's handlePaymentLinkPaid), not when a payment link
-- is merely created — so an abandoned checkout doesn't burn a
-- limited-quantity coupon's redemption count.

create table if not exists public.coupons (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,          -- normalized upper-case, e.g. 'LAUNCH20'
  discount_type     text not null check (discount_type in ('percent', 'flat')),
  discount_value    integer not null check (discount_value > 0), -- percent: 1-100; flat: paise
  plan              text,                            -- null = any plan; else must match exactly ('vault')
  max_redemptions   integer,                         -- null = unlimited
  redemption_count   integer not null default 0,
  active            boolean not null default true,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  constraint coupons_percent_range check (discount_type <> 'percent' or discount_value <= 100)
);

create index if not exists coupons_code_idx on public.coupons (code) where active;

-- ============================================================
-- coupon_redemptions: one row per successful redemption. Unique on
-- (coupon_id, user_id) — a user can redeem a given code at most once.
-- ============================================================
create table if not exists public.coupon_redemptions (
  id               uuid primary key default gen_random_uuid(),
  coupon_id        uuid not null references public.coupons(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  billing_event_id uuid references public.billing_events(id) on delete set null,
  amount_off_paise integer not null,
  created_at       timestamptz not null default now(),
  unique (coupon_id, user_id)
);

create index if not exists coupon_redemptions_user_idx on public.coupon_redemptions (user_id);

-- ============================================================
-- RLS — deny by default. Coupons are only validated/redeemed through
-- Edge Functions running with the service role, which bypasses RLS.
-- No policies means no client (anon or authenticated) can read or
-- write either table directly.
-- ============================================================
alter table public.coupons            enable row level security;
alter table public.coupon_redemptions enable row level security;

-- ============================================================
-- Atomic redemption-count bump, called by the webhook after a
-- coupon_redemptions row is inserted. Kept as a single UPDATE (rather
-- than read-then-write from the Edge Function) to avoid a lost update
-- if two payments for the same coupon confirm at once.
-- ============================================================
create or replace function public.increment_coupon_redemptions(p_coupon_id uuid)
returns void
language sql
as $$
  update public.coupons set redemption_count = redemption_count + 1 where id = p_coupon_id;
$$;
