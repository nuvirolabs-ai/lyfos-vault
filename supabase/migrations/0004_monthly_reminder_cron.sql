-- Schedule the monthly-reminder Edge Function via pg_cron + pg_net.
--
-- Prerequisites:
--   1. Enable the pg_cron and pg_net extensions in the Supabase dashboard
--      (Database → Extensions). They are not on by default on Free.
--   2. Deploy the Edge Function once:
--        supabase functions deploy monthly-reminder
--   3. Set its Resend API key:
--        supabase secrets set RESEND_API_KEY=re_xxx
--   4. Put the function's invocation Bearer token in a Supabase secret
--      called CRON_BEARER (the same as your SUPABASE_SERVICE_ROLE_KEY
--      works during the beta; rotate for production).
--   5. Run this migration. It schedules the cron job.
--
-- The job fires at 09:00 UTC on the 1st of every month — early enough
-- in the day for a calm reminder, late enough that nothing else is
-- competing for the user's attention.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop any prior schedule so this migration is idempotent.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'lyfos-monthly-reminder';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;

-- Schedule: 09:00 UTC, 1st of every month.
select cron.schedule(
  'lyfos-monthly-reminder',
  '0 9 1 * *',
  $$
    select net.http_post(
      url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/monthly-reminder'),
      headers := jsonb_build_object(
        'Authorization', concat('Bearer ', current_setting('app.settings.cron_bearer', true)),
        'content-type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);

-- Two settings the cron job reads at fire time. Set these in the
-- Supabase dashboard → Database → Settings → "Custom Postgres
-- settings" (or as direct ALTER DATABASE statements):
--   alter database postgres set "app.settings.supabase_url" = 'https://<ref>.supabase.co';
--   alter database postgres set "app.settings.cron_bearer" = '<the SUPABASE_SERVICE_ROLE_KEY>';
--
-- Do NOT commit these values to the repo.
