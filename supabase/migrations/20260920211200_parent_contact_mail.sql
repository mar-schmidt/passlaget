-- Add transactional notices to saved adult contacts. Existing private tables, RLS and worker leases are preserved.
create or replace function public.portal_backend(p_op text, p_args jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  t portal_private.teams;
  s portal_private.subscriptions;
  m portal_private.outbox;
  u record;
  j jsonb;
  result jsonb;
  count_hits integer;
  n integer;
  outcome text;
  token uuid;
  supplied_team text;
begin
  if p_op = 'read' then
    select * into t from portal_private.teams where slug = p_args->>'slug';
    if not found then return null; end if;
    return jsonb_build_object('state',t.state,'id',t.id,'version',t.version);
  elsif p_op = 'admin' then
    return to_jsonb(exists(select 1 from portal_private.admin_memberships
      where team_id=p_args->>'team_id' and user_id=(p_args->>'user_id')::uuid));
  elsif p_op = 'subscriptions' then
    return coalesce((select jsonb_agg(to_jsonb(x)) from (
      select id,team_id,family_id,adult_id,scope,email,status from portal_private.subscriptions
      where team_id=p_args->>'team_id' and status='active') x),'[]'::jsonb);
  elsif p_op = 'commit' then
    select * into t from portal_private.teams where id=p_args->>'team_id' for update;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    if t.version <> (p_args->>'expected_version')::integer then
      raise exception 'VERSION_CONFLICT' using errcode='40001';
    end if;
    if (p_args->'state') is null or jsonb_typeof(p_args->'state') <> 'object'
      or (p_args #>> '{state,team,id}') is distinct from t.id
      or (p_args #>> '{state,team,slug}') is distinct from t.slug
      or (p_args #>> '{state,version}')::integer is distinct from t.version+1
      or octet_length((p_args->'state')::text)>4000000 then
      raise exception 'INVALID_STATE' using errcode='22023';
    end if;
    update portal_private.teams set state=p_args->'state',version=t.version+1,updated_at=now() where id=t.id;
    -- The state and notification jobs commit or roll back together.
    for j in select value from jsonb_array_elements(coalesce(p_args->'jobs','[]')) loop
      if j #> '{payload,contact}' is not null then
        -- Only backend-generated jobs for an actual saved family contact may be queued.
        if j->>'kind' not in ('assignment','changed','cancelled','reminder') or not exists (
          select 1 from jsonb_array_elements(p_args #> '{state,adults}') a
          where a->>'active'='true' and a->>'email'=j->>'recipient'
            and a->'familyIds' ? (j #>> '{payload,contact,familyId}')
            and (j #> '{payload,contact,adultIds}') ? (a->>'id')
        ) then raise exception 'INVALID_CONTACT' using errcode='22023'; end if;
        insert into portal_private.outbox(team_id,subscription_id,kind,dedupe_key,recipient,subject,payload,priority,due_at)
          values(t.id,null,j->>'kind',j->>'dedupeKey',j->>'recipient',j->>'subject',j->'payload',
            (j->>'priority')::integer,(j->>'dueAt')::timestamptz) on conflict(dedupe_key) do nothing;
        continue;
      end if;
      select * into s from portal_private.subscriptions where id=(j->>'subscriptionId')::uuid and team_id=t.id and status='active';
      if found then
        insert into portal_private.outbox(team_id,subscription_id,kind,dedupe_key,recipient,subject,payload,priority,due_at)
        values(t.id,s.id,j->>'kind',j->>'dedupeKey',s.email,j->>'subject',j->'payload',
          (j->>'priority')::integer,(j->>'dueAt')::timestamptz) on conflict(dedupe_key) do nothing;
      end if;
    end loop;
    return jsonb_build_object('version',t.version+1);
  elsif p_op = 'rate_limit' then
    if length(p_args->>'key') > 150 then raise exception 'INVALID_KEY'; end if;
    delete from portal_private.rate_limits where expires_at < now()-interval '1 day';
    insert into portal_private.rate_limits(key,hits,expires_at)
      values(p_args->>'key',1,now()+make_interval(secs=>(p_args->>'window_seconds')::integer))
      on conflict(key) do update set
        hits=case when portal_private.rate_limits.expires_at<now() then 1 else portal_private.rate_limits.hits+1 end,
        expires_at=case when portal_private.rate_limits.expires_at<now() then excluded.expires_at else portal_private.rate_limits.expires_at end
      returning hits into count_hits;
    return to_jsonb(count_hits <= (p_args->>'limit')::integer);
  elsif p_op = 'subscribe' then
    select * into t from portal_private.teams where id=p_args->>'team_id';
    if not found or not exists(select 1 from jsonb_array_elements(t.state->'families') f
      where f->>'id'=p_args->>'family_id' and f->>'active'='true') then
      raise exception 'INVALID_FAMILY' using errcode='22023';
    end if;
    -- Keep already verified preferences; an anonymous caller cannot overwrite them.
    select * into s from portal_private.subscriptions where team_id=t.id and family_id=p_args->>'family_id'
      and coalesce(adult_id,'')=coalesce(p_args->>'adult_id','') and scope=p_args->>'scope'
      and email=lower(p_args->>'email') for update;
    if found and s.status='active' then return jsonb_build_object('ok',true); end if;
    if found then
      update portal_private.subscriptions set status='pending',verify_hash=p_args->>'verify_hash',
        verify_expires_at=now()+interval '48 hours' where id=s.id returning * into s;
    else
      insert into portal_private.subscriptions(team_id,family_id,adult_id,scope,email,verify_hash,verify_expires_at)
        values(t.id,p_args->>'family_id',p_args->>'adult_id',p_args->>'scope',lower(p_args->>'email'),p_args->>'verify_hash',now()+interval '48 hours') returning * into s;
    end if;
    insert into portal_private.outbox(team_id,subscription_id,kind,dedupe_key,recipient,subject,payload,priority)
      values(t.id,s.id,'verify','verify:'||(p_args->>'verify_hash'),s.email,'Bekräfta dina mejlpåminnelser',
      jsonb_build_object('token',p_args->>'token','verifyHash',p_args->>'verify_hash'),10);
    return jsonb_build_object('ok',true);
  elsif p_op = 'subscription_preview' then
    select * into s from portal_private.subscriptions where verify_hash=p_args->>'hash' and verify_expires_at>now() and status='pending';
    if not found then return null; end if;
    select * into t from portal_private.teams where id=s.team_id;
    return jsonb_build_object('subscription',to_jsonb(s),'state',t.state);
  elsif p_op = 'verify_subscription' then
    select * into s from portal_private.subscriptions where verify_hash=p_args->>'hash' and verify_expires_at>now() and status='pending';
    if not found then return jsonb_build_object('ok',false); end if;
    -- Lock the same team as publishing and advance its version, so a concurrent
    -- command cannot publish using a subscription list from before activation.
    select * into t from portal_private.teams where id=s.team_id for update;
    if p_args ? 'expected_version' and t.version<>(p_args->>'expected_version')::integer then
      raise exception 'VERSION_CONFLICT' using errcode='40001';
    end if;
    update portal_private.subscriptions set status='active',verified_at=now(),verify_hash=null,verify_expires_at=null
      where verify_hash=p_args->>'hash' and verify_expires_at>now() and status='pending' returning * into s;
    if not found then return jsonb_build_object('ok',false); end if;
    update portal_private.teams set version=version+1,state=jsonb_set(state,'{version}',to_jsonb(version+1)),updated_at=now() where id=t.id;
    -- Activate consent and create its future reminders in one transaction.
    for j in select value from jsonb_array_elements(coalesce(p_args->'jobs','[]')) loop
      if j->>'subscriptionId'=s.id::text then
        insert into portal_private.outbox(team_id,subscription_id,kind,dedupe_key,recipient,subject,payload,priority,due_at)
        values(s.team_id,s.id,j->>'kind',j->>'dedupeKey',s.email,j->>'subject',j->'payload',
          (j->>'priority')::integer,(j->>'dueAt')::timestamptz) on conflict(dedupe_key) do nothing;
      end if;
    end loop;
    select * into t from portal_private.teams where id=s.team_id;
    return jsonb_build_object('ok',true,'subscription',to_jsonb(s),'state',t.state);
  elsif p_op = 'queue_jobs' then
    for j in select value from jsonb_array_elements(coalesce(p_args->'jobs','[]')) loop
      select * into s from portal_private.subscriptions where id=(j->>'subscriptionId')::uuid and team_id=p_args->>'team_id' and status='active';
      if found then
        insert into portal_private.outbox(team_id,subscription_id,kind,dedupe_key,recipient,subject,payload,priority,due_at)
        values(s.team_id,s.id,j->>'kind',j->>'dedupeKey',s.email,j->>'subject',j->'payload',
          (j->>'priority')::integer,(j->>'dueAt')::timestamptz) on conflict(dedupe_key) do nothing;
      end if;
    end loop;
    return jsonb_build_object('ok',true);
  elsif p_op = 'unsubscribe' then
    update portal_private.subscriptions set status='unsubscribed',verify_hash=null,verify_expires_at=null where id=(p_args->>'id')::uuid;
    update portal_private.outbox set status='suppressed',last_error='unsubscribed'
      where subscription_id=(p_args->>'id')::uuid and status='queued';
    return jsonb_build_object('ok',true);
  elsif p_op = 'queue_recovery' then
    select au.id,au.email,am.team_id into u from auth.users au join portal_private.admin_memberships am on am.user_id=au.id
      where lower(au.email)=lower(p_args->>'email') order by am.team_id limit 1;
    if found then
      insert into portal_private.outbox(team_id,kind,dedupe_key,recipient,subject,payload,priority)
        values(u.team_id,'recovery',p_args->>'dedupe_key',u.email,'Återställ lösenord för Passlaget',
          jsonb_build_object('userId',u.id,'returnUrl',p_args->>'return_url'),0)
        on conflict(dedupe_key) do nothing;
    end if;
    return jsonb_build_object('ok',true);
  elsif p_op = 'mail_claim' then
    update portal_private.worker_health set last_worker_at=now() where id=true;
    update portal_private.outbox set status='uncertain',last_error='lease_expired'
      where status='leased' and lease_expires_at<now();
    n:=greatest(0,least(5,coalesce((p_args->>'limit')::integer,5)));
    result:='[]'::jsonb;
    for m in select * from portal_private.outbox where status='queued' and due_at<=now()
      order by priority,due_at,created_at limit n for update skip locked loop
      token:=gen_random_uuid();
      update portal_private.outbox set status='leased',lease_token=token,lease_expires_at=now()+interval '10 minutes',prepared_at=null where id=m.id;
      result:=result||jsonb_build_array(jsonb_build_object('id',m.id,'leaseToken',token));
    end loop;
    return jsonb_build_object('messages',result,'claimedAt',now());
  elsif p_op = 'mail_prepare' then
    select * into m from portal_private.outbox where id=(p_args->>'id')::uuid
      and lease_token=(p_args->>'lease_token')::uuid for update;
    if not found or m.status<>'leased' then return null; end if;
    if m.prepared_at is not null or m.lease_expires_at<now() then
      update portal_private.outbox set status='uncertain',last_error='prepare_repeated_or_expired' where id=m.id;
      return null;
    end if;
    select * into s from portal_private.subscriptions where id=m.subscription_id;
    select * into t from portal_private.teams where id=m.team_id;
    update portal_private.outbox set prepared_at=now() where id=m.id;
    return jsonb_build_object('mail',to_jsonb(m),'subscription',to_jsonb(s),'state',t.state);
  elsif p_op = 'mail_suppress' then
    update portal_private.outbox set status='suppressed',last_error=left(p_args->>'reason',120)
      where id=(p_args->>'id')::uuid and lease_token=(p_args->>'lease_token')::uuid and status='leased';
    return jsonb_build_object('ok',true);
  elsif p_op = 'mail_ack' then
    select * into m from portal_private.outbox where id=(p_args->>'id')::uuid for update;
    outcome:=p_args->>'outcome';
    token:=(p_args->>'lease_token')::uuid;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    if m.last_ack_token=token and m.last_ack_outcome=outcome then return jsonb_build_object('ok',true); end if;
    if m.lease_token is distinct from token or m.status not in ('leased','uncertain') or outcome not in ('sent','failed','uncertain','deferred') then
      raise exception 'INVALID_LEASE' using errcode='22023';
    end if;
    update portal_private.outbox set
      status=case when outcome='deferred' then 'queued' else outcome end,
      due_at=case when outcome='deferred' then now()+interval '5 minutes' else due_at end,
      sent_at=case when outcome='sent' then now() else sent_at end,
      last_error=case when outcome='sent' then null else left(p_args->>'error',120) end,
      prepared_at=case when outcome='deferred' then null else prepared_at end,
      last_ack_token=token,last_ack_outcome=outcome,
      -- Verification/recovery payloads may contain secrets; remove after sending.
      payload=case when outcome='sent' and kind in ('verify','recovery') then '{}'::jsonb else payload end
      where id=m.id;
    if outcome='sent' then update portal_private.worker_health set last_sent_at=now() where id=true; end if;
    return jsonb_build_object('ok',true);
  elsif p_op = 'mail_resolve' then
    supplied_team:=p_args->>'team_id';
    if not exists(select 1 from portal_private.admin_memberships where team_id=supplied_team and user_id=(p_args->>'user_id')::uuid) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    select * into m from portal_private.outbox where id=(p_args->>'id')::uuid and team_id=supplied_team for update;
    outcome:=p_args->>'outcome';
    if not found or m.status not in ('failed','uncertain') or outcome not in ('sent','retry','suppress') then raise exception 'INVALID_RESOLUTION' using errcode='22023'; end if;
    insert into portal_private.mail_resolutions(team_id,mail_id,admin_id,previous_status,decision) values(supplied_team,m.id,(p_args->>'user_id')::uuid,m.status,outcome);
    update portal_private.outbox set
      status=case when outcome='retry' then 'queued' when outcome='suppress' then 'suppressed' else 'sent' end,
      lease_token=null,lease_expires_at=null,prepared_at=null,
      due_at=case when outcome='retry' then now() else due_at end,
      sent_at=case when outcome='sent' then now() else sent_at end,
      last_error='admin_'||outcome,
      payload=case when outcome='sent' and kind in ('verify','recovery') then '{}'::jsonb else payload end
      where id=m.id;
    return jsonb_build_object('ok',true);
  elsif p_op = 'mail_status' then
    supplied_team:=p_args->>'team_id';
    select jsonb_object_agg(x.status,x.n) into result from
      (select status,count(*) n from portal_private.outbox where team_id=supplied_team group by status) x;
    return jsonb_build_object('counts',coalesce(result,'{}'::jsonb),
      'lastWorkerAt',(select last_worker_at from portal_private.worker_health where id=true),
      'lastSentAt',(select max(sent_at) from portal_private.outbox where team_id=supplied_team),
      'messages',coalesce((select jsonb_agg(to_jsonb(x)) from (select id,kind,status,recipient as "to",subject,
        created_at as "createdAt",sent_at as "sentAt",last_error as error from portal_private.outbox
        where team_id=supplied_team order by created_at desc limit 100) x),'[]'::jsonb));
  end if;
  raise exception 'UNKNOWN_OPERATION' using errcode='22023';
end;
$$;
revoke all on function public.portal_backend(text,jsonb) from public, anon, authenticated;
grant execute on function public.portal_backend(text,jsonb) to service_role;
-- No demo data or real people are seeded into production by this migration.
