begin;
alter table career_rules add column resume_docx_file_id uuid references career_files(id) on delete set null;
alter table career_mail_deliveries add column intended_recipient text, add column attachments jsonb not null default '[]';
update career_mail_deliveries set intended_recipient=recipient;
alter table job_postings add column application_analysis jsonb;
create table career_requirement_analyses (
 posting_id bigint primary key references job_postings(id) on delete cascade,
 source_hash text not null, result jsonb not null, analyzed_at timestamptz not null default now()
);
create table career_application_events (
 id uuid primary key default gen_random_uuid(),application_id uuid not null references career_applications(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,version integer not null,status text not null,
 reason text,snapshot jsonb not null,subject text,body text,recipient text,created_at timestamptz not null default now()
);
create table career_failure_notices (
 id uuid primary key default gen_random_uuid(),event_id uuid not null unique references career_application_events(id) on delete cascade,
 application_id uuid not null references career_applications(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending',payload jsonb,claimed_at timestamptz,sent_at timestamptz,created_at timestamptz not null default now()
);
create function career_record_application_event() returns trigger language plpgsql security definer set search_path=public as $$
declare eid uuid;
begin
 if TG_OP='INSERT' or old.status is distinct from new.status or old.version is distinct from new.version then
  insert into career_application_events(application_id,user_id,version,status,reason,snapshot,subject,body,recipient)
  values(new.id,new.user_id,new.version,new.status,new.reason,new.snapshot,new.subject,new.body,new.recipient) returning id into eid;
  if new.status in ('blocked','failed','delivery_unknown') then
   insert into career_failure_notices(event_id,application_id,user_id) values(eid,new.id,new.user_id);
  end if;
 end if;
 return new;
end $$;
create trigger career_application_event after insert or update on career_applications for each row execute function career_record_application_event();
do $$ declare t text; begin foreach t in array array['career_requirement_analyses','career_application_events','career_failure_notices'] loop
 execute format('alter table %I enable row level security',t);
 execute format('revoke all on %I from public,anon,authenticated',t);
 execute format('grant all on %I to service_role',t);
end loop;end $$;
revoke all on function career_record_application_event() from public,anon,authenticated;

alter table career_files drop constraint career_files_kind_check;
alter table career_files add constraint career_files_kind_check check(kind in ('template','document','resume','attachment'));
create function career_upload_attachment(p_user uuid,p_name text,p_mime text,p_data text) returns uuid language plpgsql security definer set search_path=public as $$
declare fid uuid;
begin
 if length(p_name) not between 1 and 100 or octet_length(p_data) not between 8 and 4000000 then raise exception 'resume_invalid';end if;
 insert into career_profiles(user_id) values(p_user) on conflict do nothing;
 insert into career_files(user_id,name,mime,data_base64,kind) values(p_user,p_name,p_mime,p_data,'attachment') returning id into fid;
 return fid;
end $$;
revoke all on function career_upload_attachment(uuid,text,text,text) from public,anon,authenticated;
grant execute on function career_upload_attachment(uuid,text,text,text) to service_role;
-- Both files and the preparation commit succeed together, under the existing user lock.
create function career_save_resume_pair(p_user uuid,p_file uuid,p_docx uuid,p_name text,p_subject text,p_body text,p_filters jsonb,p_mode text,p_enabled boolean,p_limit integer,p_consent text,p_expected timestamptz,p_draft_version integer default null)
returns setof career_rules language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 if not exists(select 1 from career_files where id=p_file and user_id=p_user and kind='resume' and mime='application/pdf') or
 not exists(select 1 from career_files where id=p_docx and user_id=p_user and kind='resume' and mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document') then raise exception 'resume_pair_missing';end if;
 if p_draft_version is not null then
 perform career_commit_preparation(p_user,p_file,p_name,p_subject,p_body,p_filters,p_mode,p_enabled,p_limit,p_consent,p_expected,p_draft_version);
 else perform career_save_resume_rule(p_user,p_file,p_name,p_subject,p_body,p_filters,p_mode,p_enabled,p_limit,p_consent,p_expected);end if;
 return query update career_rules set resume_docx_file_id=p_docx where user_id=p_user returning *;
end $$;
revoke all on function career_save_resume_pair(uuid,uuid,uuid,text,text,text,jsonb,text,boolean,integer,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function career_save_resume_pair(uuid,uuid,uuid,text,text,text,jsonb,text,boolean,integer,text,timestamptz,integer) to service_role;
create or replace function career_application_history(p_user uuid,p_offset integer default 0,p_status text default 'all',p_mode text default 'all',p_result text default 'all',p_search text default '',p_id uuid default null)
returns setof jsonb language sql stable security definer set search_path=public as $$
 with records as (
  select a.id::text as id,a.created_at as sort_at,
   jsonb_build_object('id',a.id,'application_id',a.id,'version',a.version,'origin',a.origin,'snapshot',a.snapshot,'company',coalesce(a.snapshot->>'company',j.company_name,'지원 공고'),'title',coalesce(a.snapshot->>'title',j.title,''),'posting_id',a.posting_id,
    'status',a.status,'mode',coalesce(d.mode,case when a.snapshot->>'auto'='true' then 'auto' else 'review' end),'created_at',a.created_at,'sent_at',d.sent_at,'reason',a.reason,'subject',a.subject,'body',a.body,'recipient',a.recipient,'actual_recipient',d.recipient,'intended_recipient',d.intended_recipient,'attachments',coalesce(d.attachments,a.snapshot->'attachments','[]'::jsonb),'document_id',coalesce(d.document_id,a.document_id),'document_name',f.name,
    'delivery_id',d.id,'delivery_status',d.status,'first_open_at',d.first_open_at,'outcome',coalesce(d.outcome,'pending'),'outcome_source',coalesce(d.outcome_source,'none'),'outcome_version',coalesce(d.outcome_version,0),'outcome_at',d.outcome_at,'reply_status',d.reply_status) as data
  from career_applications a left join job_postings j on j.id=a.posting_id
  left join lateral(select * from career_mail_deliveries where application_id=a.id and user_id=p_user order by created_at desc,id desc limit 1) d on true
  left join career_files f on f.id=coalesce(d.document_id,a.document_id) and f.user_id=p_user
  where a.user_id=p_user and a.snapshot->>'flow'='uploaded-resume-v1'
  union all
  select d.id::text,d.created_at,jsonb_build_object('id',d.id,'application_id',d.application_id,'company',d.company,'title',d.subject,'status',d.status,'mode',d.mode,'created_at',d.created_at,'sent_at',d.sent_at,'reason',d.reason,'subject',d.subject,'body',d.body,'recipient',d.recipient,'actual_recipient',d.recipient,'intended_recipient',d.intended_recipient,'attachments',d.attachments,'document_id',d.document_id,'document_name',f.name,'delivery_id',d.id,'first_open_at',d.first_open_at,'outcome',d.outcome,'outcome_source',d.outcome_source,'outcome_version',d.outcome_version,'outcome_at',d.outcome_at,'reply_status',d.reply_status)
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
