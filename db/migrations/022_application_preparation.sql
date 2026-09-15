begin;
-- Drafts never change the active rule. Uploaded resume versions remain immutable.
create table career_resume_drafts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null default '{}', version integer not null default 1,
 base_rule_updated_at timestamptz, updated_at timestamptz not null default now()
);
alter table career_resume_drafts enable row level security;
revoke all on career_resume_drafts from public,anon,authenticated;
grant all on career_resume_drafts to service_role;
create function career_save_resume_draft(p_user uuid,p_data jsonb,p_version integer,p_base timestamptz)
returns setof career_resume_drafts language plpgsql security definer set search_path=public as $$
declare previous career_resume_drafts;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 select * into previous from career_resume_drafts where user_id=p_user for update;
 if (found and previous.version<>p_version) or (not found and p_version<>0) then raise exception 'resume_conflict';end if;
 if p_data->>'resume_file_id' is not null and not exists(select 1 from career_files where id=(p_data->>'resume_file_id')::uuid and user_id=p_user and kind='resume') then raise exception 'resume_missing';end if;
 return query insert into career_resume_drafts(user_id,data,base_rule_updated_at) values(p_user,p_data,p_base)
 on conflict(user_id) do update set data=excluded.data,base_rule_updated_at=excluded.base_rule_updated_at,version=career_resume_drafts.version+1,updated_at=clock_timestamp() returning *;
end $$;
create or replace function career_upload_resume(p_user uuid,p_name text,p_mime text,p_data text) returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 if length(p_name) not between 1 and 100 or octet_length(p_data) not between 8 and 4000000 or p_mime not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document') then raise exception 'resume_invalid';end if;
 insert into career_profiles(user_id) values(p_user) on conflict do nothing;
 insert into career_files(user_id,name,mime,data_base64,kind) values(p_user,p_name,p_mime,p_data,'resume') returning id into result;
 return result;
end $$;
-- Individual replacement is archival, not deletion. Workspace/account deletion still works.
create or replace function career_delete_resume(p_user uuid,p_file uuid) returns void language plpgsql security definer set search_path=public as $$
begin raise exception 'resume_archived';end $$;
create or replace function career_save_resume_rule(p_user uuid,p_file uuid,p_name text,p_subject text,p_body text,p_filters jsonb,p_mode text,p_enabled boolean,p_limit integer,p_consent text,p_expected timestamptz)
returns setof career_rules language plpgsql security definer set search_path=public as $$
declare previous career_rules;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 select * into previous from career_rules where user_id=p_user for update;
 if (found and previous.updated_at is distinct from p_expected) or (not found and p_expected is not null) then raise exception 'resume_conflict';end if;
 if not exists(select 1 from career_files where id=p_file and user_id=p_user and kind='resume') then raise exception 'resume_missing';end if;
 if p_mode not in ('auto','review') or length(p_name) not between 1 and 80 or length(p_subject) not between 1 and 200 or length(p_body) not between 1 and 10000 then raise exception 'resume_invalid';end if;
 if p_enabled and (not exists(select 1 from career_mail_accounts where user_id=p_user) or (p_mode='auto' and p_consent is distinct from 'resume-auto-v1')) then raise exception 'resume_consent';end if;
 perform career_pause_resume(p_user);
 delete from career_resume_drafts where user_id=p_user;
 return query insert into career_rules(user_id,resume_file_id,applicant_name,mail_subject_template,mail_body_template,filters,mode,enabled,daily_limit,consent_version,enabled_since,updated_at)
 values(p_user,p_file,p_name,p_subject,p_body,p_filters,p_mode,p_enabled,null,case when p_mode='auto' then p_consent else null end,clock_timestamp(),clock_timestamp())
 on conflict(user_id) do update set resume_file_id=excluded.resume_file_id,applicant_name=excluded.applicant_name,mail_subject_template=excluded.mail_subject_template,mail_body_template=excluded.mail_body_template,
 filters=excluded.filters,mode=excluded.mode,enabled=excluded.enabled,daily_limit=excluded.daily_limit,consent_version=excluded.consent_version,template_id=null,enabled_since=excluded.enabled_since,updated_at=excluded.updated_at returning *;
end $$;

-- Commit and draft-version check share the user lock, so another tab cannot lose its draft.
create function career_commit_preparation(p_user uuid,p_file uuid,p_name text,p_subject text,p_body text,p_filters jsonb,p_mode text,p_enabled boolean,p_limit integer,p_consent text,p_expected timestamptz,p_draft_version integer)
returns setof career_rules language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 if not exists(select 1 from career_resume_drafts where user_id=p_user and version=p_draft_version) then raise exception 'resume_conflict';end if;
 return query select * from career_save_resume_rule(p_user,p_file,p_name,p_subject,p_body,p_filters,p_mode,p_enabled,p_limit,p_consent,p_expected);
end $$;
revoke all on function career_commit_preparation(uuid,uuid,text,text,text,jsonb,text,boolean,integer,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function career_commit_preparation(uuid,uuid,text,text,text,jsonb,text,boolean,integer,text,timestamptz,integer) to service_role;

alter table career_mail_accounts add column reply_read_enabled boolean not null default false,
 add column reply_checked_at timestamptz, add column reply_sync_error text;
alter table career_mail_deliveries add column sender_email text,
 add column provider_thread_id text, add column reply_checked_at timestamptz,
 add column outcome text not null default 'pending' check(outcome in ('pending','received','needs_review','passed','rejected')),
 add column outcome_source text not null default 'none' check(outcome_source in ('none','mail','manual')),
 add column outcome_at timestamptz, add column outcome_version integer not null default 0;
update career_mail_deliveries d set sender_email=a.snapshot->>'sender_email' from career_applications a where d.application_id=a.id;
create index career_reply_poll on career_mail_deliveries(user_id,reply_checked_at nulls first) where status='sent' and mode<>'test';
create table career_reply_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 delivery_id uuid not null references career_mail_deliveries(id) on delete cascade,
 document_id uuid references career_files(id) on delete set null,
 provider_message_id text, sender text, subject text, excerpt text,
 result text not null check(result in ('pending','received','needs_review','passed','rejected')),
 source text not null check(source in ('mail','manual')), received_at timestamptz not null,
 created_at timestamptz not null default now(), unique(user_id,provider_message_id)
);
alter table career_reply_events enable row level security;
revoke all on career_reply_events from public,anon,authenticated;
grant all on career_reply_events to service_role;
create index career_reply_events_delivery on career_reply_events(delivery_id,received_at desc);
create function career_record_result(p_user uuid,p_delivery uuid,p_result text,p_source text,p_expected integer default null,p_message text default null,p_sender text default null,p_subject text default null,p_excerpt text default null,p_received timestamptz default null,p_connected timestamptz default null)
returns setof career_mail_deliveries language plpgsql security definer set search_path=public as $$
declare d career_mail_deliveries; event_id uuid; event_time timestamptz:=coalesce(p_received,clock_timestamp()); next_result text:=p_result;
begin
 select * into d from career_mail_deliveries where user_id=p_user and id=p_delivery for update;
 if not found or d.status not in ('sent','delivery_unknown') then raise exception 'result_missing';end if;
 if p_source not in ('mail','manual') or p_result not in ('pending','received','needs_review','passed','rejected') then raise exception 'result_invalid';end if;
 if p_source='manual' and p_expected is distinct from d.outcome_version then raise exception 'result_conflict';end if;
 if p_source='mail' then
  if p_message is null or not exists(select 1 from career_mail_accounts where user_id=p_user and reply_read_enabled and connected_at=p_connected and lower(email)=lower(d.sender_email)) then raise exception 'result_account_changed';end if;
 end if;
 insert into career_reply_events(user_id,delivery_id,document_id,provider_message_id,sender,subject,excerpt,result,source,received_at)
 values(p_user,d.id,d.document_id,p_message,left(p_sender,254),left(p_subject,500),left(p_excerpt,2000),p_result,p_source,event_time)
 on conflict(user_id,provider_message_id) do nothing returning id into event_id;
 if event_id is null then return query select * from career_mail_deliveries where id=d.id;return;end if;
 if p_source='mail' then
  update career_mail_deliveries set reply_status='received',reply_recorded_at=greatest(reply_recorded_at,event_time) where id=d.id;
  -- A user's correction wins. Older/ambiguous follow-ups never erase a clear result.
  if d.outcome_source='manual' or (d.outcome_at is not null and event_time<d.outcome_at) or (d.outcome in ('passed','rejected') and p_result in ('pending','received','needs_review')) then
   return query select * from career_mail_deliveries where id=d.id;return;
  end if;
  if d.outcome in ('passed','rejected') and p_result in ('passed','rejected') and p_result<>d.outcome then next_result:='needs_review';end if;
 end if;
 return query update career_mail_deliveries set outcome=next_result,outcome_source=p_source,outcome_at=event_time,outcome_version=outcome_version+1 where id=d.id returning *;
end $$;

-- One application row, with its latest delivery, plus standalone historical test sends.
create function career_application_history(p_user uuid,p_offset integer default 0,p_status text default 'all',p_mode text default 'all',p_result text default 'all',p_search text default '',p_id uuid default null)
returns setof jsonb language sql stable security definer set search_path=public as $$
 with records as (
  select a.id::text as id,a.created_at as sort_at,
   jsonb_build_object('id',a.id,'application_id',a.id,'version',a.version,'origin',a.origin,'snapshot',a.snapshot,'company',coalesce(a.snapshot->>'company',j.company_name,'지원 공고'),'title',coalesce(a.snapshot->>'title',j.title,''),'posting_id',a.posting_id,
    'status',a.status,'mode',coalesce(d.mode,case when a.snapshot->>'auto'='true' then 'auto' else 'review' end),'created_at',a.created_at,'sent_at',d.sent_at,'reason',a.reason,'subject',a.subject,'body',a.body,'recipient',a.recipient,'document_id',coalesce(d.document_id,a.document_id),'document_name',f.name,
    'delivery_id',d.id,'delivery_status',d.status,'first_open_at',d.first_open_at,'outcome',coalesce(d.outcome,'pending'),'outcome_source',coalesce(d.outcome_source,'none'),'outcome_version',coalesce(d.outcome_version,0),'outcome_at',d.outcome_at,'reply_status',d.reply_status) as data
  from career_applications a left join job_postings j on j.id=a.posting_id
  left join lateral(select * from career_mail_deliveries where application_id=a.id and user_id=p_user order by created_at desc,id desc limit 1) d on true
  left join career_files f on f.id=coalesce(d.document_id,a.document_id) and f.user_id=p_user
  where a.user_id=p_user and a.snapshot->>'flow'='uploaded-resume-v1'
  union all
  select d.id::text,d.created_at,jsonb_build_object('id',d.id,'application_id',d.application_id,'company',d.company,'title',d.subject,'status',d.status,'mode',d.mode,'created_at',d.created_at,'sent_at',d.sent_at,'reason',d.reason,'subject',d.subject,'body',d.body,'recipient',d.recipient,'document_id',d.document_id,'document_name',f.name,'delivery_id',d.id,'first_open_at',d.first_open_at,'outcome',d.outcome,'outcome_source',d.outcome_source,'outcome_version',d.outcome_version,'outcome_at',d.outcome_at,'reply_status',d.reply_status)
  from career_mail_deliveries d left join career_files f on f.id=d.document_id and f.user_id=p_user
  where d.user_id=p_user and not exists(select 1 from career_applications a where a.id=d.application_id and a.user_id=p_user and a.snapshot->>'flow'='uploaded-resume-v1')
 ) select data from records where (p_id is null or id=p_id::text) and (p_status='all' or data->>'status'=p_status) and (p_mode='all' or data->>'mode'=p_mode) and (p_result='all' or data->>'outcome'=p_result)
 and (p_search='' or position(lower(p_search) in lower((data->>'company')||' '||(data->>'title')))>0)
 order by sort_at desc,id desc limit 26 offset p_offset;
$$;
revoke all on function career_save_resume_draft(uuid,jsonb,integer,timestamptz),career_record_result(uuid,uuid,text,text,integer,text,text,text,text,timestamptz,timestamptz),career_application_history(uuid,integer,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function career_save_resume_draft(uuid,jsonb,integer,timestamptz),career_record_result(uuid,uuid,text,text,integer,text,text,text,text,timestamptz,timestamptz),career_application_history(uuid,integer,text,text,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
