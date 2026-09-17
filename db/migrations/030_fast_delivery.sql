begin;
-- Retain timing independently from leases (which are cleared when work completes).
alter table career_analysis_jobs add column enqueued_at timestamptz not null default now(),add column started_at timestamptz,add column completed_at timestamptz;
create function career_analysis_timing() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status='pending' and new.attempts=0 then new.enqueued_at=clock_timestamp();new.started_at=null;new.completed_at=null;end if;
 if new.status='processing' and new.started_at is null then new.started_at=clock_timestamp();end if;
 if new.status in ('done','failed') then new.completed_at=clock_timestamp();end if;
 return new;
end $$;
create trigger career_analysis_clock before update on career_analysis_jobs for each row execute function career_analysis_timing();
revoke all on function career_analysis_timing() from public,anon,authenticated;
create table career_pipeline_health(id boolean primary key default true check(id),checked_at timestamptz not null,summary jsonb not null);
alter table career_pipeline_health enable row level security;
revoke all on career_pipeline_health from public,anon,authenticated;
grant all on career_pipeline_health to service_role;
create function career_work_pending() returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; oldest_analysis numeric; oldest_delivery numeric; overdue integer;
begin
 select coalesce(max(extract(epoch from now()-enqueued_at)),0) into oldest_analysis from career_analysis_jobs where status in ('pending','processing');
 select coalesce(max(extract(epoch from now()-coalesce(approved_at,created_at))),0) into oldest_delivery from career_applications where status='queued' and deleted_at is null and snapshot->>'flow'='uploaded-resume-v1';
 select count(*) into overdue from career_applications a left join job_postings j on j.id=a.posting_id
 where a.deleted_at is null and a.snapshot->>'flow'='uploaded-resume-v1' and
 ((a.status in ('queued','sending') and coalesce(a.approved_at,a.created_at)<now()-interval '10 minutes') or
 (a.origin='rule' and a.status='preparing' and j.first_seen_at<now()-interval '10 minutes'));
 result=jsonb_build_object(
 'delivery',exists(select 1 from career_applications where status='queued' and deleted_at is null and snapshot->>'flow'='uploaded-resume-v1'),
 'analysis',career_analysis_pending(),
 'prepare',exists(select 1 from career_applications where deleted_at is null and snapshot->>'flow'='uploaded-resume-v1' and (status='preparing' or(status='sending' and updated_at<now()-interval '20 minutes')))
  or exists(select 1 from career_pending_review_notices())
  or exists(select 1 from career_review_notices where status='pending')
  or exists(select 1 from career_failure_notices where status='pending'),
 'oldest_analysis_seconds',floor(oldest_analysis),'oldest_delivery_seconds',floor(oldest_delivery),'overdue_count',overdue);
 insert into career_pipeline_health(id,checked_at,summary) values(true,now(),result) on conflict(id) do update set checked_at=excluded.checked_at,summary=excluded.summary;
 return result;
end $$;
revoke all on function career_work_pending() from public,anon,authenticated;
grant execute on function career_work_pending() to service_role;
-- A queued full-scan dispatch can be replaced by the next minute's run. Persist
-- completion so the next available crawler promotes itself to a full scan.
create table crawl_full_scans(board text primary key,completed_at timestamptz not null);
alter table crawl_full_scans enable row level security;
revoke all on crawl_full_scans from public,anon,authenticated;
grant all on crawl_full_scans to service_role;
create function crawl_full_scan_due(p_board text) returns boolean language sql stable security definer set search_path=public as $$
 select not exists(select 1 from crawl_full_scans where board=p_board and completed_at>now()-interval '10 minutes');
$$;
create function crawl_record_full_scan(p_board text) returns void language sql security definer set search_path=public as $$
 insert into crawl_full_scans(board,completed_at) values(p_board,now()) on conflict(board) do update set completed_at=excluded.completed_at;
$$;
revoke all on function crawl_full_scan_due(text),crawl_record_full_scan(text) from public,anon,authenticated;
grant execute on function crawl_full_scan_due(text),crawl_record_full_scan(text) to service_role;
notify pgrst,'reload schema';
commit;
