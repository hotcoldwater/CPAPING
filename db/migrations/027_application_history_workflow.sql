begin;
-- Existing postings are not backfilled when this workflow goes live.
alter table career_rules add column history_since timestamptz not null default now();
-- A stale worker cannot add old postings or insert after automation was turned off.
create function career_guard_new_application() returns trigger language plpgsql security definer set search_path=public as $$
declare r career_rules; seen timestamptz;
begin
 if new.origin<>'rule' or new.snapshot->>'flow' is distinct from 'uploaded-resume-v1' then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,1701));
 select * into r from career_rules where user_id=new.user_id;
 if not found or not r.enabled then return null;end if;
 select (to_jsonb(j)->>'first_seen_at')::timestamptz into seen from job_postings j where j.id=new.posting_id;
 if seen is null or seen<=greatest(r.enabled_since,r.history_since) then return null;end if;
 return new;
end $$;
create trigger career_new_application_guard before insert on career_applications for each row execute function career_guard_new_application();
revoke all on function career_guard_new_application() from public,anon,authenticated;
alter table career_applications
 add column manual_status text check(manual_status in ('review','blocked','sent','passed','final_passed','rejected')),
 add column site_applied_on date;
alter table career_application_events add column manual_status text, add column site_applied_on date;
create function career_set_application_status(p_user uuid,p_application uuid,p_expected integer,p_status text,p_applied_on date default null)
returns setof career_applications language plpgsql security definer set search_path=public as $$
declare a career_applications;
begin
 select * into a from career_applications where id=p_application and user_id=p_user and snapshot->>'flow'='uploaded-resume-v1' for update;
 if not found then raise exception 'application_missing';end if;
 if p_expected is distinct from a.version or a.status in ('preparing','queued','sending') then raise exception 'application_conflict';end if;
 if p_status is null or p_status not in ('review','blocked','sent','passed','final_passed','rejected') then raise exception 'application_invalid';end if;
 if a.snapshot->'analysis'->>'method'='website' then
  if p_status in ('sent','passed','final_passed','rejected') and p_applied_on is null then raise exception 'application_date';end if;
  if p_applied_on > (now() at time zone 'Asia/Seoul')::date then raise exception 'application_date';end if;
 elsif p_applied_on is not null then raise exception 'application_date';end if;
 return query update career_applications set manual_status=p_status,
 site_applied_on=case when a.snapshot->'analysis'->>'method'='website' then p_applied_on else null end,
 version=version+1,updated_at=now() where id=a.id returning *;
end $$;
revoke all on function career_set_application_status(uuid,uuid,integer,text,date) from public,anon,authenticated;
grant execute on function career_set_application_status(uuid,uuid,integer,text,date) to service_role;
create or replace function career_record_application_event() returns trigger language plpgsql security definer set search_path=public as $$
declare eid uuid;
begin
 if TG_OP='INSERT' or old.status is distinct from new.status or old.version is distinct from new.version then
  insert into career_application_events(application_id,user_id,version,status,reason,snapshot,subject,body,recipient,manual_status,site_applied_on)
  values(new.id,new.user_id,new.version,new.status,new.reason,new.snapshot,new.subject,new.body,new.recipient,new.manual_status,new.site_applied_on) returning id into eid;
  if new.status in ('blocked','failed','delivery_unknown') and (TG_OP='INSERT' or old.status is distinct from new.status or old.reason is distinct from new.reason) then
   insert into career_failure_notices(event_id,application_id,user_id) values(eid,new.id,new.user_id);
  end if;
 end if;
 return new;
end $$;
create or replace function career_record_result(p_user uuid,p_delivery uuid,p_result text,p_source text,p_expected integer default null,p_message text default null,p_sender text default null,p_subject text default null,p_excerpt text default null,p_received timestamptz default null,p_connected timestamptz default null)
returns setof career_mail_deliveries language plpgsql security definer set search_path=public as $$
declare d career_mail_deliveries; event_id uuid; event_time timestamptz:=coalesce(p_received,clock_timestamp()); next_result text:=p_result;
begin
 select * into d from career_mail_deliveries where user_id=p_user and id=p_delivery for update;
 if not found or d.status not in ('sent','delivery_unknown') then raise exception 'result_missing';end if;
 if p_source='mail' then return next d;return;end if;
 if p_source not in ('mail','manual') or p_result not in ('pending','received','needs_review','passed','rejected') then raise exception 'result_invalid';end if;
 if p_source='manual' and p_expected is distinct from d.outcome_version then raise exception 'result_conflict';end if;
 insert into career_reply_events(user_id,delivery_id,document_id,provider_message_id,sender,subject,excerpt,result,source,received_at)
 values(p_user,d.id,d.document_id,p_message,left(p_sender,254),left(p_subject,500),left(p_excerpt,2000),p_result,p_source,event_time)
 on conflict(user_id,provider_message_id) do nothing returning id into event_id;
 if event_id is null then return query select * from career_mail_deliveries where id=d.id;return;end if;
 return query update career_mail_deliveries set outcome=next_result,outcome_source=p_source,outcome_at=event_time,outcome_version=outcome_version+1 where id=d.id returning *;
end $$;

create or replace function career_application_history(p_user uuid,p_offset integer default 0,p_status text default 'all',p_mode text default 'all',p_result text default 'all',p_search text default '',p_id uuid default null)
returns setof jsonb language sql stable security definer set search_path=public as $$
 with records as (
  select a.id::text as id,a.created_at as sort_at,
   jsonb_build_object('id',a.id,'application_id',a.id,'version',a.version,'origin',a.origin,'snapshot',a.snapshot,'company',coalesce(a.snapshot->>'company',j.company_name,'지원 공고'),'title',coalesce(a.snapshot->>'title',j.title,''),'posting_id',a.posting_id,
    'status',a.status,'manual_status',a.manual_status,'site_applied_on',a.site_applied_on,'region',coalesce(nullif(j.work_region,''),nullif(j.region,''),case j.region_group when 'capital' then '수도권' when 'local' then '지방' end),'posted_at',j.posted_at,'display_status',coalesce(a.manual_status,case when d.outcome_source='manual' and d.outcome in ('passed','rejected') then d.outcome when a.status='sent' then 'sent' when a.status in ('blocked','failed','delivery_unknown','cancelled') then 'blocked' else 'review' end),'mode',coalesce(d.mode,case when a.snapshot->>'auto'='true' then 'auto' else 'review' end),'created_at',a.created_at,'sent_at',coalesce(d.sent_at,a.sent_at),'reason',a.reason,'subject',a.subject,'body',a.body,'recipient',a.recipient,'actual_recipient',d.recipient,'intended_recipient',d.intended_recipient,'attachments',coalesce(d.attachments,a.snapshot->'attachments','[]'::jsonb),'document_id',coalesce(d.document_id,a.document_id),'document_name',f.name,
    'delivery_id',d.id,'delivery_status',d.status,'first_open_at',d.first_open_at,'outcome',coalesce(d.outcome,'pending'),'outcome_source',coalesce(d.outcome_source,'none'),'outcome_version',coalesce(d.outcome_version,0),'outcome_at',d.outcome_at,'reply_status',d.reply_status) as data
  from career_applications a left join job_postings j on j.id=a.posting_id
  left join lateral(select * from career_mail_deliveries where application_id=a.id and user_id=p_user order by created_at desc,id desc limit 1) d on true
  left join career_files f on f.id=coalesce(d.document_id,a.document_id) and f.user_id=p_user
  where a.user_id=p_user and a.snapshot->>'flow'='uploaded-resume-v1'
  union all
  select d.id::text,d.created_at,jsonb_build_object('id',d.id,'application_id',d.application_id,'company',d.company,'title',d.subject,'status',d.status,'display_status',case when d.outcome_source='manual' and d.outcome in ('passed','rejected') then d.outcome when d.status='sent' then 'sent' else 'blocked' end,'mode',d.mode,'created_at',d.created_at,'sent_at',d.sent_at,'reason',d.reason,'subject',d.subject,'body',d.body,'recipient',d.recipient,'actual_recipient',d.recipient,'intended_recipient',d.intended_recipient,'attachments',d.attachments,'document_id',d.document_id,'document_name',f.name,'delivery_id',d.id,'first_open_at',d.first_open_at,'outcome',d.outcome,'outcome_source',d.outcome_source,'outcome_version',d.outcome_version,'outcome_at',d.outcome_at,'reply_status',d.reply_status)
  from career_mail_deliveries d left join career_files f on f.id=d.document_id and f.user_id=p_user
  where d.user_id=p_user and not exists(select 1 from career_applications a where a.id=d.application_id and a.user_id=p_user and a.snapshot->>'flow'='uploaded-resume-v1')
 ) select data from records where (p_id is null or id=p_id::text) and (p_status='all' or data->>'display_status'=p_status) and (p_mode='all' or data->>'mode'=p_mode) and (p_result='all' or data->>'outcome'=p_result)
 and (p_search='' or position(lower(p_search) in lower((data->>'company')||' '||(data->>'title')))>0)
 order by sort_at desc,id desc limit 26 offset p_offset;
$$;
notify pgrst,'reload schema';
commit;
