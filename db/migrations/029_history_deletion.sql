begin;
-- Keep delivery evidence and duplicate protection after a user removes a list entry.
alter table career_applications add column deleted_at timestamptz;
alter table career_mail_deliveries add column deleted_at timestamptz;
create function career_delete_history(p_user uuid,p_id uuid,p_kind text,p_expected integer) returns void
language plpgsql security definer set search_path=public as $$
declare a career_applications; d career_mail_deliveries;
begin
 if p_kind='application' then
  select * into a from career_applications where id=p_id and user_id=p_user and deleted_at is null and snapshot->>'flow'='uploaded-resume-v1' for update;
  if not found then raise exception 'application_missing';end if;
  if a.version is distinct from p_expected or a.status='sending' then raise exception 'application_conflict';end if;
  update career_applications set deleted_at=now(),version=version+1,updated_at=now(),
   status=case when status in ('sent','delivery_unknown') then status else 'cancelled' end where id=a.id;
  update career_review_notices set status='cancelled' where application_id=a.id and user_id=p_user and status='pending';
  update career_failure_notices set status='cancelled' where application_id=a.id and user_id=p_user and status='pending';
 elsif p_kind='delivery' then
  select * into d from career_mail_deliveries where id=p_id and user_id=p_user and deleted_at is null for update;
  if not found then raise exception 'application_missing';end if;
  if d.outcome_version is distinct from p_expected or d.status='sending'
   or exists(select 1 from career_applications where id=d.application_id and user_id=p_user and snapshot->>'flow'='uploaded-resume-v1') then raise exception 'application_conflict';end if;
  update career_mail_deliveries set deleted_at=now(),outcome_version=outcome_version+1 where id=d.id;
 else raise exception 'application_invalid';end if;
end $$;
-- Choosing Apply again restores the same entry; it never approves or queues a send.
create function career_restore_history(p_user uuid,p_id uuid) returns setof career_applications
language plpgsql security definer set search_path=public as $$
begin
 return query update career_applications set deleted_at=null,version=version+1,updated_at=now()
 where id=p_id and user_id=p_user and deleted_at is not null and status<>'sending' and snapshot->>'flow'='uploaded-resume-v1' returning *;
end $$;
revoke all on function career_delete_history(uuid,uuid,text,integer),career_restore_history(uuid,uuid) from public,anon,authenticated;
grant execute on function career_delete_history(uuid,uuid,text,integer),career_restore_history(uuid,uuid) to service_role;
create or replace function career_set_application_status(p_user uuid,p_application uuid,p_expected integer,p_status text,p_applied_on date default null)
returns setof career_applications language plpgsql security definer set search_path=public as $$
declare a career_applications;
begin
 select * into a from career_applications where id=p_application and user_id=p_user and deleted_at is null and snapshot->>'flow'='uploaded-resume-v1' for update;
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
create or replace function career_application_history(p_user uuid,p_offset integer default 0,p_status text default 'all',p_mode text default 'all',p_result text default 'all',p_search text default '',p_id uuid default null)
returns setof jsonb language sql stable security definer set search_path=public as $$
 with records as (
  select a.id::text as id,a.created_at as sort_at,
   jsonb_build_object('id',a.id,'entry_kind','application','application_id',a.id,'version',a.version,'origin',a.origin,'snapshot',a.snapshot,'company',coalesce(a.snapshot->>'company',j.company_name,'지원 공고'),'title',coalesce(a.snapshot->>'title',j.title,''),'posting_id',a.posting_id,
    'status',a.status,'manual_status',a.manual_status,'site_applied_on',a.site_applied_on,'region',coalesce(nullif(j.work_region,''),nullif(j.region,''),case j.region_group when 'capital' then '수도권' when 'local' then '지방' end),'posted_at',j.posted_at,'display_status',coalesce(a.manual_status,case when d.outcome_source='manual' and d.outcome in ('passed','rejected') then d.outcome when a.status='preparing' then 'analyzing' when a.status='sent' then 'sent' when a.status in ('blocked','failed','delivery_unknown','cancelled') then 'blocked' else 'review' end),'mode',coalesce(d.mode,case when a.snapshot->>'auto'='true' then 'auto' else 'review' end),'created_at',a.created_at,'sent_at',coalesce(d.sent_at,a.sent_at),'reason',a.reason,'subject',a.subject,'body',a.body,'recipient',a.recipient,'actual_recipient',d.recipient,'intended_recipient',d.intended_recipient,'attachments',coalesce(d.attachments,a.snapshot->'attachments','[]'::jsonb),'document_id',coalesce(d.document_id,a.document_id),'document_name',f.name,
    'delivery_id',d.id,'delivery_status',d.status,'first_open_at',d.first_open_at,'outcome',coalesce(d.outcome,'pending'),'outcome_source',coalesce(d.outcome_source,'none'),'outcome_version',coalesce(d.outcome_version,0),'outcome_at',d.outcome_at,'reply_status',d.reply_status) as data
  from career_applications a left join job_postings j on j.id=a.posting_id
  left join lateral(select * from career_mail_deliveries where application_id=a.id and user_id=p_user order by created_at desc,id desc limit 1) d on true
  left join career_files f on f.id=coalesce(d.document_id,a.document_id) and f.user_id=p_user
  where a.user_id=p_user and a.deleted_at is null and a.snapshot->>'flow'='uploaded-resume-v1'
  union all
  select d.id::text,d.created_at,jsonb_build_object('id',d.id,'entry_kind','delivery','application_id',d.application_id,'company',d.company,'title',d.subject,'status',d.status,'display_status',case when d.outcome_source='manual' and d.outcome in ('passed','rejected') then d.outcome when d.status='sent' then 'sent' else 'blocked' end,'mode',d.mode,'created_at',d.created_at,'sent_at',d.sent_at,'reason',d.reason,'subject',d.subject,'body',d.body,'recipient',d.recipient,'actual_recipient',d.recipient,'intended_recipient',d.intended_recipient,'attachments',d.attachments,'document_id',d.document_id,'document_name',f.name,'delivery_id',d.id,'first_open_at',d.first_open_at,'outcome',d.outcome,'outcome_source',d.outcome_source,'outcome_version',d.outcome_version,'outcome_at',d.outcome_at,'reply_status',d.reply_status)
  from career_mail_deliveries d left join career_files f on f.id=d.document_id and f.user_id=p_user
  where d.user_id=p_user and d.deleted_at is null and not exists(select 1 from career_applications a where a.id=d.application_id and a.user_id=p_user and a.snapshot->>'flow'='uploaded-resume-v1')
 ) select data from records where (p_id is null or id=p_id::text) and (p_status='all' or data->>'display_status'=p_status) and (p_mode='all' or data->>'mode'=p_mode) and (p_result='all' or data->>'outcome'=p_result)
 and (p_search='' or position(lower(p_search) in lower((data->>'company')||' '||(data->>'title')))>0)
 order by sort_at desc,id desc limit 26 offset p_offset;
$$;
notify pgrst,'reload schema';
commit;
