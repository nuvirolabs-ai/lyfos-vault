-- Product decision: recovery no longer requires an uploaded death/
-- incapacity document or an admin review gate before the other
-- nominees are asked to support. It still requires the same
-- independent multi-party approval (primary/backup files, two other
-- verified nominees each independently approve on their own account),
-- and it still goes through the same `holding` -> `ready_to_recover`
-- state machine and app_runtime_settings.release_hold_interval — that
-- part is unchanged and already configurable (currently set short for
-- testing; intended to move back to 14 days for production).
--
-- This migration only removes the evidence requirement and the
-- separate admin-approval step: a filed request goes straight to
-- 'collecting_support' and immediately queues the supporter emails
-- (previously queued only once an admin approved). The admin
-- review RPCs remain in place for any requests already in
-- 'under_review' from before this change.

create or replace function public.create_relationship_recovery_request(
  p_holder_id uuid,
  p_request_kind text,
  p_fallback_reason text default null,
  p_evidence_summary text default null,
  p_evidence_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_email text;
  v_owner_email text;
  v_holder public.key_holders%rowtype;
  v_generation uuid;
  v_request uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select * into v_holder from public.key_holders
   where id = p_holder_id and holder_user_id = v_caller and status = 'verified';
  if v_holder.id is null then raise exception 'entrusted vault not found'; end if;
  if p_request_kind = 'normal' and v_holder.role <> 'primary' then raise exception 'only the primary can start normal recovery'; end if;
  if p_request_kind = 'backup' and v_holder.role <> 'backup' then raise exception 'only the backup can start fallback recovery'; end if;
  if p_request_kind = 'backup' and coalesce(length(trim(p_fallback_reason)), 0) < 10 then raise exception 'fallback reason is required'; end if;
  if p_evidence_path is not null and p_evidence_path not like v_caller::text || '/%' then raise exception 'evidence document does not belong to this account'; end if;
  select id into v_generation from public.circle_generations
   where owner_id = v_holder.owner_id and state = 'active';
  if v_generation is null then raise exception 'circle is not active'; end if;

  select email::text into v_email from auth.users where id = v_caller;
  select email::text into v_owner_email from auth.users where id = v_holder.owner_id;

  insert into public.release_requests (
    owner_id, nominee_user_id, nominee_email_at_request, state,
    recipient_holder_id, circle_generation_id, recipient_role, recipient_key_version,
    request_kind, fallback_reason, evidence_summary, death_certificate_path,
    reviewed_at, approved_at
  ) values (
    v_holder.owner_id, v_caller, v_email, 'collecting_support',
    v_holder.id, v_generation, v_holder.role, v_holder.recovery_key_version,
    p_request_kind, nullif(trim(p_fallback_reason), ''), nullif(trim(p_evidence_summary), ''), p_evidence_path,
    now(), now()
  ) returning id into v_request;

  insert into public.email_deliveries (
    purpose, related_holder_id, related_request_id, recipient_email, idempotency_key
  )
  select 'recovery_support', h.id, v_request, h.holder_email,
         'recovery-support:' || v_request::text || ':' || h.id::text
    from public.key_holders h
   where h.owner_id = v_holder.owner_id
     and h.status = 'verified'
     and h.id <> v_holder.id
  on conflict (idempotency_key) do nothing;

  insert into public.email_deliveries (
    purpose, related_request_id, recipient_email, idempotency_key
  )
  values ('owner_alert', v_request, v_owner_email, 'owner-recovery-approved:' || v_request::text)
  on conflict (idempotency_key) do nothing;

  insert into public.audit_log (user_id, event_type, event_meta)
  values (v_holder.owner_id, 'release_approved', jsonb_build_object('request_id', v_request, 'note', 'auto: review step removed'));

  return v_request;
end;
$$;

-- Notify the owner the moment their vault is actually opened by a
-- nominee, in addition to the existing audit_log entry.
create or replace function public.mark_recipient_recovery_opened(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_owner_email text;
  v_nominee_email text;
begin
  update public.release_requests
     set state = 'opened', completed_at = coalesce(completed_at, now())
   where id = p_request_id
     and nominee_user_id = auth.uid()
     and state = 'ready_to_recover'
  returning owner_id, nominee_email_at_request into v_owner, v_nominee_email;
  if v_owner is null then raise exception 'ready recovery request not found'; end if;

  insert into public.audit_log (user_id, event_type, event_meta)
  values (v_owner, 'recipient_recovery_opened', jsonb_build_object('request_id', p_request_id));

  select email::text into v_owner_email from auth.users where id = v_owner;

  insert into public.email_deliveries (
    purpose, related_request_id, recipient_email, idempotency_key
  )
  values ('owner_alert', p_request_id, v_owner_email, 'owner-vault-opened:' || p_request_id::text)
  on conflict (idempotency_key) do nothing;
end;
$$;
