-- Lyfos — invoice infrastructure.
--
-- A separate Storage bucket for invoice PDFs + a monotonic counter
-- table that hands out sequential invoice numbers (required for
-- Indian GST compliance — gaps in the sequence are a red flag during
-- an assessment).
--
-- Invoice number format: LYF-YYYY-NNNNNN
--   Year prefix lets us reset the counter on April 1 each Indian
--   financial year if we want (we currently let it monotonically
--   increase forever — also valid).

-- Storage bucket
insert into storage.buckets (id, name, public)
  values ('invoices', 'invoices', false)
  on conflict (id) do nothing;

-- Only the user the invoice belongs to (signed in) can read it.
drop policy if exists "user reads own invoice" on storage.objects;
create policy "user reads own invoice"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Monotonic counter
create table if not exists public.invoice_counter (
  id              integer primary key default 1,
  next_value      bigint  not null default 1,
  updated_at      timestamptz not null default now(),
  check (id = 1)
);
insert into public.invoice_counter (id, next_value) values (1, 1) on conflict (id) do nothing;

create or replace function public.allocate_invoice_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
  v_year text := to_char(now(), 'YYYY');
begin
  update public.invoice_counter
     set next_value = next_value + 1, updated_at = now()
   where id = 1
  returning next_value - 1 into v_next;
  return 'LYF-' || v_year || '-' || lpad(v_next::text, 6, '0');
end;
$$;

-- Helper read-only RPC the invoice generator uses to look up the
-- buyer's billing profile (server-side: no RLS gymnastics needed
-- because the generator runs with the service role).
