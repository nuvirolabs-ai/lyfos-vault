-- 0014_onboarding_emails.sql
-- Helper RPC + cron schedule for the 7-email onboarding sequence.
-- Apply AFTER deploying the `onboarding-emails` Edge Function.

create or replace function public.onboarding_email_candidates()
returns table (
  user_id uuid,
  email text,
  first_name text,
  created_at timestamptz,
  record_count int,
  release_plan_finalised boolean,
  recovery_phrase_downloaded boolean,
  is_paid boolean,
  emails_sent int[]
)
language sql security definer set search_path = public as $$
  select u.id as user_id,
         u.email::text,
         (u.raw_user_meta_data->>'first_name') as first_name,
         u.created_at,
         coalesce(jsonb_array_length(vb.encrypted_record->'items'), 0) as record_count,
         coalesce(exists (
           select 1 from public.key_shares ks
            where ks.owner_id = u.id
         ), false) as release_plan_finalised,
         coalesce((select bool_or(al.event_type = 'recovery_phrase_downloaded')
                     from public.audit_log al where al.user_id = u.id), false)
           as recovery_phrase_downloaded,
         coalesce((select s.status in ('active','trialing')
                     from public.subscriptions s where s.user_id = u.id
                    order by s.created_at desc limit 1), false) as is_paid,
         coalesce((select array_agg((al.event_meta->>'email_number')::int)
                     from public.audit_log al
                    where al.user_id = u.id
                      and al.event_type = 'onboarding_email_sent'), array[]::int[]) as emails_sent
    from auth.users u
    left join public.vault_blobs vb on vb.user_id = u.id
   where u.created_at >= now() - interval '31 days'
     and u.email_confirmed_at is not null;
$$;

revoke all on function public.onboarding_email_candidates() from public;
grant execute on function public.onboarding_email_candidates() to service_role;
