\set ON_ERROR_STOP on

begin;

create temporary table ceremony_users (name text primary key, id uuid not null, email text not null);
insert into ceremony_users values
  ('owner',   '10000000-0000-0000-0000-000000000001', 'owner@ceremony.test'),
  ('primary', '10000000-0000-0000-0000-000000000002', 'primary@ceremony.test'),
  ('backup',  '10000000-0000-0000-0000-000000000003', 'backup@ceremony.test'),
  ('trusted1','10000000-0000-0000-0000-000000000004', 'trusted1@ceremony.test'),
  ('trusted2','10000000-0000-0000-0000-000000000005', 'trusted2@ceremony.test'),
  ('trusted3','10000000-0000-0000-0000-000000000006', 'trusted3@ceremony.test'),
  ('wrong',   '10000000-0000-0000-0000-000000000007', 'wrong@ceremony.test'),
  ('admin',   '10000000-0000-0000-0000-000000000008', 'admin@ceremony.test');
grant select on ceremony_users to authenticated;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
select id, email,
       case when name = 'wrong' then '{"role":"admin"}'::jsonb else '{}'::jsonb end,
       case when name = 'admin' then '{"role":"admin"}'::jsonb else '{}'::jsonb end
from ceremony_users;

insert into public.subscriptions (user_id, plan, status)
values ((select id from ceremony_users where name = 'owner'), 'vault', 'active');

insert into public.vault_blobs (user_id, encrypted_record, size_bytes, client_updated_at)
values (
  (select id from ceremony_users where name = 'owner'),
  '{"kind":"os-one-stage1-vault","version":2,"encryptedVault":{"iv":"local-iv","ciphertext":"local-cipher"}}',
  128,
  now()
);

create temporary table ceremony_invites (
  name text primary key,
  role text not null,
  holder_id uuid not null,
  token text not null,
  delivery_id uuid not null
);
grant select, insert on ceremony_invites to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'owner'), true);
insert into ceremony_invites
select 'primary', 'primary', invite_id, invite_token, delivery_id
  from public.create_key_holder_invite('primary@ceremony.test', null, 'Primary person', 'primary');
insert into ceremony_invites
select 'backup', 'backup', invite_id, invite_token, delivery_id
  from public.create_key_holder_invite('backup@ceremony.test', null, 'Backup person', 'backup');
insert into ceremony_invites
select 'trusted1', 'trusted', invite_id, invite_token, delivery_id
  from public.create_key_holder_invite('trusted1@ceremony.test', null, 'Trusted one', 'trusted');
insert into ceremony_invites
select 'trusted2', 'trusted', invite_id, invite_token, delivery_id
  from public.create_key_holder_invite('trusted2@ceremony.test', null, 'Trusted two', 'trusted');
insert into ceremony_invites
select 'trusted3', 'trusted', invite_id, invite_token, delivery_id
  from public.create_key_holder_invite('trusted3@ceremony.test', null, 'Trusted three', 'trusted');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'owner'), true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.requeue_key_holder_invite((select holder_id from ceremony_invites where name = 'primary'));
  exception when others then
    rejected := position('available after 60 seconds' in sqlerrm) > 0;
  end;
  if not rejected then raise exception 'invite resend bypassed the server cooldown'; end if;
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.key_holders where invite_token is null and invite_token_hash is not null) <> 5 then
    raise exception 'invite tokens must be stored only as hashes';
  end if;
  if (select count(*) from public.email_deliveries where purpose = 'holder_invite' and state = 'queued') <> 5 then
    raise exception 'every invite must have a queued delivery ledger row';
  end if;
  if (select count(*) from public.invite_email_outbox o
        join public.email_deliveries d on d.id = o.delivery_id
       where d.purpose = 'holder_invite'
         and public.hash_circle_token(o.invite_token) = (select h.invite_token_hash from public.key_holders h where h.id = d.related_holder_id)) <> 5 then
    raise exception 'every queued invite must retain a service-only dispatch token';
  end if;
  if not exists (select 1 from cron.job where jobname = 'lyfos-invite-email-outbox') then
    raise exception 'durable invite outbox is not scheduled';
  end if;
  if not exists (select 1 from cron.job where jobname = 'lyfos-recovery-notification-outbox') then
    raise exception 'durable recovery notification outbox is not scheduled';
  end if;
end;
$$;

insert into public.email_deliveries (id, purpose, recipient_email, state, idempotency_key)
values ('91000000-0000-0000-0000-000000000001', 'auth_confirmation', 'race@ceremony.test', 'queued', 'race-reconciliation');
insert into public.email_delivery_events (event_id, provider_message_id, event_type, payload, occurred_at)
values ('race-event-1', 'provider-race-1', 'email.delivered', '{"type":"email.delivered","data":{"email_id":"provider-race-1"}}', now());
do $$
begin
  if public.apply_email_delivery_events('provider-race-1') then
    raise exception 'event unexpectedly matched before provider id was stored';
  end if;
  update public.email_deliveries set state = 'sent', provider_message_id = 'provider-race-1'
   where id = '91000000-0000-0000-0000-000000000001';
  if not public.apply_email_delivery_events('provider-race-1') then
    raise exception 'stored provider event was not reconciled';
  end if;
  if (select state from public.email_deliveries where id = '91000000-0000-0000-0000-000000000001') <> 'delivered' then
    raise exception 'fast provider webhook was lost';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'wrong'), true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.accept_invite((select token from ceremony_invites where name = 'primary'), repeat('w', 44));
  exception when others then
    rejected := position('sign in with the email' in sqlerrm) > 0;
  end;
  if not rejected then raise exception 'wrong-email invite acceptance was not rejected'; end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'primary'), true);
select public.accept_invite((select token from ceremony_invites where name = 'primary'), repeat('p', 44));
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'backup'), true);
select public.accept_invite((select token from ceremony_invites where name = 'backup'), repeat('b', 44));
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'trusted1'), true);
select public.accept_invite((select token from ceremony_invites where name = 'trusted1'), repeat('1', 44));
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'trusted2'), true);
select public.accept_invite((select token from ceremony_invites where name = 'trusted2'), repeat('2', 44));
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'trusted3'), true);
select public.accept_invite((select token from ceremony_invites where name = 'trusted3'), repeat('3', 44));
reset role;

create temporary table ceremony_generation (id uuid primary key);
grant select, insert on ceremony_generation to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'owner'), true);
insert into ceremony_generation
select public.activate_circle_generation(
  jsonb_build_object(
    'algorithm', 'recipient-gate-xor-sss-2of5-v1',
    'shares', (
      select jsonb_agg(jsonb_build_object(
        'holder_id', holder_id,
        'share_index', row_number,
        'ciphertext', 'sealed-share-' || row_number,
        'ephemeral_pub', 'share-ephemeral-' || row_number,
        'commitment', repeat(substr(md5(holder_id::text), 1, 1), 64)
      ) order by row_number)
      from (
        select holder_id, row_number() over (order by name) as row_number
        from ceremony_invites
      ) ordered_invites
    ),
    'primary', jsonb_build_object(
      'holder_id', (select holder_id from ceremony_invites where name = 'primary'),
      'ciphertext', 'primary-gate', 'ephemeral_pub', 'primary-gate-pub',
      'instructions_ciphertext', 'primary-note', 'instructions_ephemeral_pub', 'primary-note-pub'
    ),
    'backup', jsonb_build_object(
      'holder_id', (select holder_id from ceremony_invites where name = 'backup'),
      'ciphertext', 'backup-gate', 'ephemeral_pub', 'backup-gate-pub',
      'instructions_ciphertext', 'backup-note', 'instructions_ephemeral_pub', 'backup-note-pub'
    )
  )
);
reset role;

do $$
begin
  if (select count(*) from public.key_holders where status = 'verified' and circle_generation = 1) <> 5 then
    raise exception 'atomic activation did not verify all five nominees';
  end if;
  if (select count(*) from public.key_shares where sss_threshold = 2 and generation_id = (select id from ceremony_generation)) <> 5 then
    raise exception 'atomic activation did not create five 2-of-5 masked shares';
  end if;
  if (select count(*) from public.key_shares where share_commitment ~ '^[0-9a-f]{64}$') <> 5 then
    raise exception 'atomic activation did not bind every masked share to a commitment';
  end if;
  if (select count(*) from public.recipient_gate_envelopes where generation_id = (select id from ceremony_generation)) <> 2 then
    raise exception 'atomic activation did not create primary and backup gate envelopes';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'wrong'), true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.get_entrusted_instructions((select holder_id from ceremony_invites where name = 'primary'));
  exception when others then
    rejected := position('entrusted instructions not found' in sqlerrm) > 0;
  end;
  if not rejected then raise exception 'unrelated account read recipient instructions'; end if;
end;
$$;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'primary'), true);
do $$
begin
  if (public.get_entrusted_instructions((select holder_id from ceremony_invites where name = 'primary'))->>'ciphertext') <> 'primary-note' then
    raise exception 'primary could not read their encrypted owner instructions';
  end if;
end;
$$;
reset role;

create temporary table ceremony_request (id uuid primary key);
grant select, insert on ceremony_request to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'primary'), true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.create_relationship_recovery_request(
      (select holder_id from ceremony_invites where name = 'primary'),
      'normal', null, null, null
    );
  exception when others then
    rejected := position('evidence summary and document are required' in sqlerrm) > 0;
  end;
  if not rejected then raise exception 'recovery request was accepted without evidence'; end if;
end;
$$;
insert into ceremony_request
select public.create_relationship_recovery_request(
  (select holder_id from ceremony_invites where name = 'primary'),
  'normal', null, 'Official evidence reviewed in local ceremony',
  (select id::text || '/evidence.pdf' from ceremony_users where name = 'primary')
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'wrong'), true);
do $$
declare approval_rejected boolean := false; certificate_rejected boolean := false;
begin
  begin
    perform public.admin_approve_release((select id from ceremony_request), 'forged client metadata');
  exception when others then
    approval_rejected := position('not authorized' in sqlerrm) > 0;
  end;
  begin
    perform public.admin_get_certificate_url((select id from ceremony_request));
  exception when others then
    certificate_rejected := position('not authorized' in sqlerrm) > 0;
  end;
  if not approval_rejected or not certificate_rejected then
    raise exception 'client-editable user metadata forged an admin authorization';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'admin'), true);
select public.admin_approve_release((select id from ceremony_request), 'Local ceremony approval');
reset role;

do $$
begin
  if (select count(*) from public.email_deliveries where related_request_id = (select id from ceremony_request) and purpose = 'recovery_support') <> 4 then
    raise exception 'approval did not queue all four independent supporting nominees';
  end if;
  if (select count(*) from public.email_deliveries where related_request_id = (select id from ceremony_request) and purpose = 'owner_alert') <> 1 then
    raise exception 'approval did not queue the immediate owner alert';
  end if;
end;
$$;

insert into public.app_runtime_settings (key, value)
values ('release_hold_interval', '0 seconds')
on conflict (key) do update set value = excluded.value;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'primary'), true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.release_supporting_share((select id from ceremony_request), repeat('A', 186) || '==', repeat('B', 43) || '=');
  exception when others then
    rejected := position('recipient share cannot count' in sqlerrm) > 0;
  end;
  if not rejected then raise exception 'recipient was allowed to support their own recovery'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'trusted1'), true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.release_supporting_share((select id from ceremony_request), '', 'not-base64');
  exception when others then
    rejected := position('malformed' in sqlerrm) > 0;
  end;
  if not rejected then raise exception 'malformed supporting envelope counted toward recovery'; end if;
  if exists (select 1 from public.release_share_releases where release_request_id = (select id from ceremony_request)) then
    raise exception 'malformed support changed the release threshold';
  end if;
end;
$$;
select public.release_supporting_share((select id from ceremony_request), repeat('C', 186) || '==', repeat('D', 43) || '=');
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'trusted3'), true);
select public.refuse_recovery_support((select id from ceremony_request), 'I cannot verify this request independently');
do $$
declare rejected boolean := false;
begin
  begin
    perform public.release_supporting_share((select id from ceremony_request), repeat('E', 186) || '==', repeat('F', 43) || '=');
  exception when others then
    rejected := position('already refused' in sqlerrm) > 0;
  end;
  if not rejected then raise exception 'a refusal was later counted as released support'; end if;
end;
$$;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'primary'), true);
do $$
declare progress jsonb;
begin
  progress := public.recipient_recovery_progress((select id from ceremony_request));
  if progress <> '{"approved":1,"refused":1,"waiting":2,"required":2}'::jsonb then
    raise exception 'recipient progress counts are wrong: %', progress;
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'trusted2'), true);
select public.release_supporting_share((select id from ceremony_request), repeat('G', 186) || '==', repeat('H', 43) || '=');
reset role;

do $$
begin
  if (select state from public.release_requests where id = (select id from ceremony_request)) <> 'holding' then
    raise exception 'second independent support did not start the hold';
  end if;
  if (select count(*) from public.release_share_releases where release_request_id = (select id from ceremony_request)) <> 2 then
    raise exception 'support threshold must contain exactly two independent shares';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'trusted3'), true);
do $$
declare rejected boolean := false;
begin
  begin
    perform public.get_ready_recovery_material((select id from ceremony_request));
  exception when others then
    rejected := position('recovery request not found' in sqlerrm) > 0;
  end;
  if not rejected then raise exception 'non-recipient accessed recovery material'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'primary'), true);
select public.get_ready_recovery_material((select id from ceremony_request));
select public.report_invalid_recovery_support(
  (select id from ceremony_request),
  (select holder_id from ceremony_invites where name = 'trusted1')
);
reset role;

do $$
begin
  if (select state from public.release_requests where id = (select id from ceremony_request)) <> 'collecting_support' then
    raise exception 'invalid authenticated support did not resume collection';
  end if;
  if (select count(*) from public.email_deliveries where related_request_id = (select id from ceremony_request) and purpose = 'recovery_support') <> 5 then
    raise exception 'remaining eligible nominee was not re-notified after invalid support';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'backup'), true);
select public.release_supporting_share((select id from ceremony_request), repeat('I', 186) || '==', repeat('J', 43) || '=');
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'primary'), true);
create temporary table ceremony_material as
select public.get_ready_recovery_material((select id from ceremony_request)) as payload;
grant select on ceremony_material to authenticated;
select public.mark_recipient_recovery_opened((select id from ceremony_request));
reset role;

update public.vault_blobs
   set encrypted_record = '{"ciphertext":"future-owner-update"}'::jsonb
 where user_id = (select id from ceremony_users where name = 'owner');

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'primary'), true);
create temporary table ceremony_reopened_material as
select public.get_ready_recovery_material((select id from ceremony_request)) as payload;
grant select on ceremony_reopened_material to authenticated;
reset role;

do $$
begin
  if jsonb_array_length((select payload->'released_shares' from ceremony_material)) <> 2 then
    raise exception 'recipient did not receive exactly two supporting shares';
  end if;
  if (select payload->'gate_envelope'->>'ciphertext' from ceremony_material) <> 'primary-gate' then
    raise exception 'recipient received the wrong gate envelope';
  end if;
  if (select state from public.release_requests where id = (select id from ceremony_request)) <> 'opened' then
    raise exception 'successful recovery was not marked opened';
  end if;
  if (select payload->'encrypted_record' from ceremony_reopened_material)
       <> (select payload->'encrypted_record' from ceremony_material) then
    raise exception 'reopening exposed a future owner vault update instead of the authorized snapshot';
  end if;
end;
$$;

create temporary table backup_request (id uuid primary key);
grant select, insert on backup_request to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'backup'), true);
insert into backup_request
select public.create_relationship_recovery_request(
  (select holder_id from ceremony_invites where name = 'backup'),
  'backup', 'Primary is documented as unable to act', 'Backup evidence summary for review',
  (select id::text || '/backup.pdf' from ceremony_users where name = 'backup')
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'owner'), true);
select public.owner_abort_release((select id from backup_request), 'owner_safe');
reset role;

do $$
begin
  if (select state from public.release_requests where id = (select id from backup_request)) <> 'aborted' then
    raise exception 'owner abort did not seal the recipient-gated request';
  end if;
end;
$$;

rollback;

\echo 'recipient-gated circle ceremony passed'
