begin;
create table career_analysis_jobs (
 posting_id bigint primary key references job_postings(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','processing','done','failed')),
 attempts integer not null default 0,available_at timestamptz not null default now(),
 locked_at timestamptz,lease uuid,last_error text,updated_at timestamptz not null default now()
);
alter table career_analysis_jobs enable row level security;
revoke all on career_analysis_jobs from public,anon,authenticated;
grant all on career_analysis_jobs to service_role;
create index career_analysis_pending on career_analysis_jobs(available_at) where status in ('pending','processing');

create function career_enqueue_analysis(p_posting bigint,p_force boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare p job_postings;
begin
 select * into p from job_postings where id=p_posting for update;
 if not found then return;end if;
 if not p_force and p.application_analysis->>'state' in ('classified','needs_confirmation') then return;end if;
 if p_force then update job_postings set application_analysis=null where id=p_posting;end if;
 insert into career_analysis_jobs(posting_id) values(p_posting) on conflict(posting_id) do update
 set status='pending',attempts=0,available_at=now(),lease=null,locked_at=null,last_error=null,updated_at=now()
 where career_analysis_jobs.status in ('done','failed') or p_force;
end $$;
create function career_queue_posting_analysis() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.application_analysis is null and coalesce(to_jsonb(new)->'recruitment_categories','[]'::jsonb) ? 'entry_cpa' then
  -- Source edits invalidate leases so an older analysis cannot overwrite the edit.
  if TG_OP='INSERT' or old.application_analysis is not null or
     to_jsonb(old)->'body' is distinct from to_jsonb(new)->'body' or
     to_jsonb(old)->'source_content' is distinct from to_jsonb(new)->'source_content' or
     to_jsonb(old)->'content_hash' is distinct from to_jsonb(new)->'content_hash' or
     to_jsonb(old)->'recruitment_categories' is distinct from to_jsonb(new)->'recruitment_categories' then
   insert into career_analysis_jobs(posting_id) values(new.id) on conflict(posting_id) do update
    set status='pending',attempts=0,available_at=now(),lease=null,locked_at=null,last_error=null,updated_at=now();
  end if;
 end if;
 return new;
end $$;
create trigger career_analysis_enqueue after insert or update on job_postings for each row execute function career_queue_posting_analysis();
create function career_analysis_pending() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from career_analysis_jobs where (status='pending' and available_at<=now()) or (status='processing' and locked_at<now()-interval '7 minutes'))
 and not exists(select 1 from career_analysis_jobs where status='processing' and locked_at>=now()-interval '7 minutes');
$$;
create function career_claim_analysis() returns setof career_analysis_jobs language plpgsql security definer set search_path=public as $$
declare job_id bigint;
begin
 select posting_id into job_id from career_analysis_jobs
 where (status='pending' and available_at<=now()) or (status='processing' and locked_at<now()-interval '7 minutes')
 order by available_at,posting_id for update skip locked limit 1;
 if not found then return;end if;
 return query update career_analysis_jobs set status='processing',attempts=attempts+1,lease=gen_random_uuid(),locked_at=now(),updated_at=now() where posting_id=job_id returning *;
end $$;
create function career_finish_analysis(p_posting bigint,p_lease uuid,p_result jsonb default null,p_error text default null) returns boolean
language plpgsql security definer set search_path=public as $$
declare job career_analysis_jobs; result jsonb:=p_result;
begin
 -- Match enqueue's lock order (posting, then job) to avoid deadlocks with source refresh.
 perform 1 from job_postings where id=p_posting for update;
 select * into job from career_analysis_jobs where posting_id=p_posting for update;
 if not found or job.status<>'processing' or job.lease is distinct from p_lease then return false;end if;
 if result is null and job.attempts<3 then
  update career_analysis_jobs set status='pending',available_at=now()+make_interval(secs=>20*job.attempts),lease=null,locked_at=null,last_error=left(p_error,800),updated_at=now() where posting_id=p_posting;
  return true;
 end if;
 if result is null then result=jsonb_build_object('state','needs_confirmation','version','requirements-v2','uncertainty',jsonb_build_array('AI 분석을 3회 시도했지만 완료하지 못했습니다. '||coalesce(left(p_error,500),'공고를 직접 확인해 주세요.')),'blockers','[]'::jsonb);end if;
 if result->>'state' not in ('classified','needs_confirmation') or result->>'state' is null then raise exception 'analysis_invalid';end if;
 update career_analysis_jobs set status=case when p_result is null then 'failed' else 'done' end,lease=null,locked_at=null,last_error=left(p_error,800),updated_at=now() where posting_id=p_posting;
 update job_postings set application_analysis=result where id=p_posting;
 if result->>'evidence_hash' is not null then
  insert into career_requirement_analyses(posting_id,source_hash,result,analyzed_at) values(p_posting,result->>'evidence_hash',result,now())
  on conflict(posting_id) do update set source_hash=excluded.source_hash,result=excluded.result,analyzed_at=excluded.analyzed_at;
 end if;
 return true;
end $$;
revoke all on function career_enqueue_analysis(bigint,boolean),career_queue_posting_analysis(),career_analysis_pending(),career_claim_analysis(),career_finish_analysis(bigint,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function career_enqueue_analysis(bigint,boolean),career_analysis_pending(),career_claim_analysis(),career_finish_analysis(bigint,uuid,jsonb,text) to service_role;
-- Queue currently unanalysed visible postings, without adding old jobs to application history.
insert into career_analysis_jobs(posting_id) select id from job_postings j
 where j.application_analysis is null and coalesce(to_jsonb(j)->'recruitment_categories','[]'::jsonb) ? 'entry_cpa'
 and not coalesce(j.is_expired,false) and j.removed_at is null on conflict do nothing;
-- Repair only untouched direct applications that were blocked solely before analysis.
update career_applications a set status='preparing',reason=null,version=version+1,updated_at=now()
 where status='blocked' and manual_status is null and snapshot->>'flow'='uploaded-resume-v1'
 and coalesce(snapshot->>'manual_edit','false')<>'true'
 and reason like '지원 요건을 확인하지 못했습니다. 공고를 확인하고 직접 작성해 주세요.%'
 and not exists(select 1 from career_mail_deliveries d where d.application_id=a.id);
create or replace function career_application_history(p_user uuid,p_offset integer default 0,p_status text default 'all',p_mode text default 'all',p_result text default 'all',p_search text default '',p_id uuid default null)
returns setof jsonb language sql stable security definer set search_path=public as $$
 with records as (
  select a.id::text as id,a.created_at as sort_at,
   jsonb_build_object('id',a.id,'application_id',a.id,'version',a.version,'origin',a.origin,'snapshot',a.snapshot,'company',coalesce(a.snapshot->>'company',j.company_name,'지원 공고'),'title',coalesce(a.snapshot->>'title',j.title,''),'posting_id',a.posting_id,
    'status',a.status,'manual_status',a.manual_status,'site_applied_on',a.site_applied_on,'region',coalesce(nullif(j.work_region,''),nullif(j.region,''),case j.region_group when 'capital' then '수도권' when 'local' then '지방' end),'posted_at',j.posted_at,'display_status',coalesce(a.manual_status,case when d.outcome_source='manual' and d.outcome in ('passed','rejected') then d.outcome when a.status='preparing' then 'analyzing' when a.status='sent' then 'sent' when a.status in ('blocked','failed','delivery_unknown','cancelled') then 'blocked' else 'review' end),'mode',coalesce(d.mode,case when a.snapshot->>'auto'='true' then 'auto' else 'review' end),'created_at',a.created_at,'sent_at',coalesce(d.sent_at,a.sent_at),'reason',a.reason,'subject',a.subject,'body',a.body,'recipient',a.recipient,'actual_recipient',d.recipient,'intended_recipient',d.intended_recipient,'attachments',coalesce(d.attachments,a.snapshot->'attachments','[]'::jsonb),'document_id',coalesce(d.document_id,a.document_id),'document_name',f.name,
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
