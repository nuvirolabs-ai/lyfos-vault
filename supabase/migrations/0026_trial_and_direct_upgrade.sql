-- Give every new account a 30-day Vault trial from the moment they
-- sign up, and make the server-side paid-plan gate actually respect
-- subscription status/expiry (it previously only looked at the `plan`
-- column, so a cancelled or expired trial subscription would still
-- read as paid forever).

-- ============================================================
-- current_plan_for: now status- and expiry-aware, mirroring the
-- client-side entitlementsFor() in apps/web/src/lib/plans.js.
-- ============================================================
create or replace function public.current_plan_for(p_user uuid)
returns text
language sql
stable
as $$
  select case
    when s.status = 'active' then s.plan
    when s.status = 'trialing' and s.current_period_end > now() then s.plan
    when s.status = 'past_due' and (s.grace_until is null or s.grace_until > now()) then s.plan
    else 'free'
  end
  from public.subscriptions s
  where s.user_id = p_user;
$$;

-- ============================================================
-- Auto-start a 30-day Vault trial for every new signup.
-- on conflict do nothing so this never clobbers a subscription row
-- that already exists (e.g. an account created directly via the
-- admin API with a real plan already set).
-- ============================================================
create or replace function public.start_trial_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (
    user_id, plan, status, provider,
    current_period_start, current_period_end
  ) values (
    new.id, 'vault', 'trialing', 'trial',
    now(), now() + interval '30 days'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_start_trial on auth.users;
create trigger on_auth_user_created_start_trial
  after insert on auth.users
  for each row execute function public.start_trial_on_signup();

-- ============================================================
-- Daily housekeeping: flip trials whose period has ended to
-- 'expired' so the Settings billing UI reflects it, rather than
-- relying purely on the read-time expiry check above.
-- ============================================================
select cron.schedule(
  'lyfos-expire-trials',
  '17 3 * * *',
  $$
    update public.subscriptions
       set status = 'expired'
     where status = 'trialing' and current_period_end < now();
  $$
);
