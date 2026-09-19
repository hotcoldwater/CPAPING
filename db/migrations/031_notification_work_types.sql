-- Freeze delivery eligibility at discovery: a content backfill must not send old jobs.
begin;
alter table public.job_postings add column if not exists notification_work_types text[];
update public.job_postings set notification_work_types = case
 when employment_type='Part Time' then array['part_time']
 when employment_type is not null then array['full_time']
 else array[]::text[] end where notification_work_types is null;
create or replace function public.posting_notification_work_types() returns trigger
language plpgsql set search_path=public as $$
begin
 new.notification_work_types := case
  when coalesce(cardinality(new.work_types),0)>0 then new.work_types
  when new.employment_type='Part Time' then array['part_time']
  when new.employment_type is not null then array['full_time']
  else array[]::text[] end;
 -- The existing full-time subscription also includes internships.
 if not new.notification_work_types && array['full_time','part_time'] and new.employment_type is not null then
  new.notification_work_types := array_append(new.notification_work_types,'full_time');
 end if;
 return new;
end $$;
drop trigger if exists posting_notification_work_types on public.job_postings;
create trigger posting_notification_work_types before insert on public.job_postings
 for each row execute function public.posting_notification_work_types();
revoke all on function public.posting_notification_work_types() from public,anon,authenticated;
comment on column public.job_postings.notification_work_types is
 'Work-type notification eligibility at discovery. Existing jobs retain pre-rollout eligibility; document refreshes never expand recipients.';
notify pgrst,'reload schema';
commit;
