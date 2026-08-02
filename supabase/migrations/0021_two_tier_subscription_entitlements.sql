-- Lyfos now has two public versions:
--   free  -> 11 entries, no balance sheet, no release finalization
--   vault -> unlimited entries, balance sheet, Circle of Trust release
--
-- Retired plan ids such as "family" should not grant new release shares.

create or replace function public.assert_paid_for_release()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_plan text;
begin
  v_plan := coalesce(public.current_plan_for(new.owner_id), 'free');
  if v_plan <> 'vault' then
    raise exception 'paid_plan_required: a Vault subscription is required to finalize a release plan';
  end if;
  return new;
end;
$$;

drop trigger if exists key_shares_require_paid on public.key_shares;
create trigger key_shares_require_paid
  before insert on public.key_shares
  for each row execute function public.assert_paid_for_release();
