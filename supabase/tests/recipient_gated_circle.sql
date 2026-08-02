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

insert into auth.users (id, email, raw_user_meta_data)
select id, email, case when name = 'admin' then '{"role":"admin"}'::jsonb else '{}'::jsonb end
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

do $$
begin
  if (select count(*) from public.key_holders where invite_token is null and invite_token_hash is not null) <> 5 then
    raise exception 'invite tokens must be stored only as hashes';
  end if;
  if (select count(*) from public.email_deliveries where purpose = 'holder_invite' and state = 'queued') <> 5 then
    raise exception 'every invite must have a queued delivery ledger row';
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
        'ephemeral_pub', 'share-ephemeral-' || row_number
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
  if (select count(*) from public.recipient_gate_envelopes where generation_id = (select id from ceremony_generation)) <> 2 then
    raise exception 'atomic activation did not create primary and backup gate envelopes';
  end if;
end;
$$;

create temporary table ceremony_request (id uuid primary key);
grant select, insert on ceremony_request to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'primary'), true);
insert into ceremony_request
select public.create_relationship_recovery_request(
  (select holder_id from ceremony_invites where name = 'primary'),
  'normal', null, 'Official evidence reviewed in local ceremony', 'ceremony/evidence.pdf'
);
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
    perform public.release_supporting_share((select id from ceremony_request), 'self-share', 'self-pub');
  exception when others then
    rejected := position('recipient share cannot count' in sqlerrm) > 0;
  end;
  if not rejected then raise exception 'recipient was allowed to support their own recovery'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'trusted1'), true);
select public.release_supporting_share((select id from ceremony_request), 'support-one', 'support-one-pub');
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'trusted2'), true);
select public.release_supporting_share((select id from ceremony_request), 'support-two', 'support-two-pub');
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
create temporary table ceremony_material as
select public.get_ready_recovery_material((select id from ceremony_request)) as payload;
grant select on ceremony_material to authenticated;
select public.mark_recipient_recovery_opened((select id from ceremony_request));
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
end;
$$;

create temporary table backup_request (id uuid primary key);
grant select, insert on backup_request to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from ceremony_users where name = 'backup'), true);
insert into backup_request
select public.create_relationship_recovery_request(
  (select holder_id from ceremony_invites where name = 'backup'),
  'backup', 'Primary is documented as unable to act', 'Backup evidence summary for review', 'ceremony/backup.pdf'
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
