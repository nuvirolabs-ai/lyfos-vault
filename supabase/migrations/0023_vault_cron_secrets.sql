-- Hosted Supabase does not grant the SQL Editor's role permission to run
-- `alter database postgres set "app.settings.*"` (custom GUCs require
-- database-owner/superuser privilege that Supabase reserves for itself).
-- That leaves the four pg_cron jobs below reading a null URL and an empty
-- bearer token, so their net.http_post calls silently fail.
--
-- Fix: store the two values in Supabase Vault (encrypted secrets table)
-- and have the cron jobs read them from there instead of a GUC.
--
-- This migration only creates placeholder secrets. After running it,
-- fill in the real values from the SQL Editor (never commit them):
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'cron_supabase_url'),
--     'https://<your-project-ref>.supabase.co'
--   );
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'cron_service_role_key'),
--     '<the SUPABASE_SERVICE_ROLE_KEY>'
--   );

create extension if not exists supabase_vault;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_supabase_url') then
    perform vault.create_secret(
      'REPLACE_ME',
      'cron_supabase_url',
      'Base URL pg_cron jobs use to call this project''s Edge Functions.'
    );
  end if;

  if not exists (select 1 from vault.secrets where name = 'cron_service_role_key') then
    perform vault.create_secret(
      'REPLACE_ME',
      'cron_service_role_key',
      'Service-role bearer token pg_cron jobs use to authenticate to Edge Functions.'
    );
  end if;
end $$;

-- Reschedule the four jobs that depended on app.settings.* to read from
-- Vault instead.

do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'lyfos-monthly-reminder';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;

select cron.schedule(
  'lyfos-monthly-reminder',
  '0 9 1 * *',
  $$
    select net.http_post(
      url := concat(
        (select decrypted_secret from vault.decrypted_secrets where name = 'cron_supabase_url'),
        '/functions/v1/monthly-reminder'
      ),
      headers := jsonb_build_object(
        'Authorization', concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')),
        'content-type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $$
);

do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'lyfos-release-alert-dispatcher';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;

select cron.schedule(
  'lyfos-release-alert-dispatcher',
  '7 * * * *',
  $$
    select net.http_post(
      url := concat(
        (select decrypted_secret from vault.decrypted_secrets where name = 'cron_supabase_url'),
        '/functions/v1/release-alert-dispatcher'
      ),
      headers := jsonb_build_object(
        'Authorization', concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')),
        'content-type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'lyfos-invite-email-outbox';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;

select cron.schedule(
  'lyfos-invite-email-outbox',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := concat(
        (select decrypted_secret from vault.decrypted_secrets where name = 'cron_supabase_url'),
        '/functions/v1/send-key-holder-invite'
      ),
      headers := jsonb_build_object(
        'Authorization', concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')),
        'content-type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'lyfos-recovery-notification-outbox';
  if jid is not null then perform cron.unschedule(jid); end if;
end $$;

select cron.schedule(
  'lyfos-recovery-notification-outbox',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := concat(
        (select decrypted_secret from vault.decrypted_secrets where name = 'cron_supabase_url'),
        '/functions/v1/send-recovery-notifications'
      ),
      headers := jsonb_build_object(
        'Authorization', concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_service_role_key')),
        'content-type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
