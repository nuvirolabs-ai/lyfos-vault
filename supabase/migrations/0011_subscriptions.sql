-- Lyfos subscriptions schema.
--
-- One row per user with a current plan + status. The actual recurring
-- payment lives in Razorpay (or Stripe later); we keep a thin local
-- mirror so we can gate features without round-tripping to the
-- payment provider every render.
--
-- Sources of truth:
--   - Razorpay → razorpay_subscription_id, status, current_period_end
--   - Stripe   → stripe_subscription_id, status, current_period_end
-- Webhooks from either provider update this table.

-- ============================================================
-- subscriptions: per-user plan + status
-- ============================================================
create table if not exists public.subscriptions (
  user_id                   uuid primary key references auth.users(id) on delete cascade,
  plan                      text not null default 'free',  -- 'free' | 'vault' | 'family'
  status                    text not null default 'active', -- 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired'
  provider                  text,                           -- 'razorpay' | 'stripe' | null (for free)
  razorpay_customer_id      text,
  razorpay_subscription_id  text,
  stripe_customer_id        text,
  stripe_subscription_id    text,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean not null default false,
  cancelled_at              timestamptz,
  grace_until               timestamptz,                    -- when past_due, the date after which we go read-only
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists subscriptions_status_idx on public.subscriptions (status);
create index if not exists subscriptions_period_end_idx on public.subscriptions (current_period_end) where status in ('active','past_due');
create unique index if not exists subscriptions_rzp_unique on public.subscriptions (razorpay_subscription_id) where razorpay_subscription_id is not null;
create unique index if not exists subscriptions_stripe_unique on public.subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

-- ============================================================
-- billing_events: append-only log of every subscription/payment
-- event, source of truth for the invoice list. Updates to
-- subscriptions are derived from these.
-- ============================================================
create table if not exists public.billing_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  provider            text not null,             -- 'razorpay' | 'stripe' | 'system'
  event_type          text not null,             -- 'subscription.activated', 'payment.captured', etc.
  provider_event_id   text,                       -- idempotency key from provider
  provider_payment_id text,                       -- the actual charge id, if any
  amount_paise        integer,                    -- in INR paise (1 INR = 100 paise)
  currency            text default 'INR',
  invoice_pdf_path    text,                       -- supabase storage path, set after PDF generation
  invoice_number      text,
  invoice_state       text,                       -- buyer's state for CGST/SGST/IGST split
  invoice_gstin       text,                       -- buyer's GSTIN, if B2B
  payload             jsonb,                       -- the raw webhook payload (PII-scrubbed)
  created_at          timestamptz not null default now(),
  unique (provider, provider_event_id) -- protects against double-processing
);

create index if not exists billing_events_user_idx on public.billing_events (user_id, created_at desc);
create index if not exists billing_events_invoice_idx on public.billing_events (invoice_number) where invoice_number is not null;

-- ============================================================
-- billing_profile: optional buyer details for tax invoice
-- ============================================================
create table if not exists public.billing_profile (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  legal_name     text,
  state_code     text,   -- "MH", "KA", etc. — used to decide IGST vs CGST+SGST
  state_name     text,
  gstin          text,   -- optional, B2B
  pan            text,   -- optional, future
  address_line1  text,
  address_line2  text,
  city           text,
  pincode        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ============================================================
-- RLS
-- ============================================================
alter table public.subscriptions  enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_profile enable row level security;

drop policy if exists "user reads own subscription" on public.subscriptions;
create policy "user reads own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Writes to subscriptions go ONLY through the webhook handler (service role).
-- No insert/update/delete RLS policy for authenticated users.

drop policy if exists "user reads own billing events" on public.billing_events;
create policy "user reads own billing events"
  on public.billing_events for select
  using (auth.uid() = user_id);

drop policy if exists "user reads own billing profile" on public.billing_profile;
drop policy if exists "user upserts own billing profile" on public.billing_profile;
drop policy if exists "user updates own billing profile" on public.billing_profile;

create policy "user reads own billing profile"
  on public.billing_profile for select
  using (auth.uid() = user_id);

create policy "user upserts own billing profile"
  on public.billing_profile for insert
  with check (auth.uid() = user_id);

create policy "user updates own billing profile"
  on public.billing_profile for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at triggers
drop trigger if exists subscriptions_touch_updated on public.subscriptions;
create trigger subscriptions_touch_updated
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

drop trigger if exists billing_profile_touch_updated on public.billing_profile;
create trigger billing_profile_touch_updated
  before update on public.billing_profile
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Helper: server-side plan + entitlement read
-- Used by RPCs that need to enforce gating (e.g. preventing a free
-- user from finalizing a release plan)
-- ============================================================
create or replace function public.current_plan_for(p_user uuid)
returns text
language sql
stable
as $$
  select plan from public.subscriptions where user_id = p_user;
$$;

-- Add a write-side check on finalize: only paid plans can hold a
-- key_shares row. We add this as a trigger to be brutal — the client
-- already checks but defense-in-depth here is cheap.
create or replace function public.assert_paid_for_release()
returns trigger
language plpgsql
as $$
declare
  v_plan text;
begin
  v_plan := coalesce(public.current_plan_for(new.owner_id), 'free');
  if v_plan = 'free' then
    raise exception 'paid_plan_required: a Vault or Family subscription is required to finalize a release plan';
  end if;
  return new;
end;
$$;

drop trigger if exists key_shares_require_paid on public.key_shares;
create trigger key_shares_require_paid
  before insert on public.key_shares
  for each row execute function public.assert_paid_for_release();
