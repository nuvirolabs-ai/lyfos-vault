-- Schedule the release-alert-dispatcher to run hourly.
--
-- Why hourly, not daily: we want to catch holds whose ready_at has
-- expired ASAP so the nominee can download as soon as possible. The
-- per-channel-per-day idempotency check inside the function ensures
-- we don't spam the owner with 24 alerts — at most one per channel
-- per UTC day.
--
-- Prerequisites:
--   - 0004_monthly_reminder_cron.sql already enabled pg_cron + pg_net
--     and set app.settings.supabase_url + app.settings.cron_bearer
--   - The Edge Function release-alert-dispatcher is deployed
--   - At least RESEND_API_KEY is set in Edge Function secrets
--     (SMS + WhatsApp degrade gracefully if their creds aren't set)

do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'lyfos-release-alert-dispatcher';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;

-- Hourly at minute 7 (offset from 0 so we don't pile up with other
-- 00:00 jobs on shared infra).
select cron.schedule(
  'lyfos-release-alert-dispatcher',
  '7 * * * *',
  $$
    select net.http_post(
      url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/release-alert-dispatcher'),
      headers := jsonb_build_object(
        'Authorization', concat('Bearer ', current_setting('app.settings.cron_bearer', true)),
        'content-type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
