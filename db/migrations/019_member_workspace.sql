begin;
create table public.member_details (
 user_id uuid primary key references auth.users(id) on delete cascade,
 full_name text check (length(full_name) <= 80),
 birth_date date check (birth_date >= date '1900-01-01'),
 phone text check (length(phone) <= 30),
 school text check (length(school) <= 120),
 pass_year integer check (pass_year between 1950 and 2200),
 research_consent boolean not null default false,
 research_consented_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.member_details enable row level security;
revoke all on public.member_details from public, anon, authenticated;
grant all on public.member_details to service_role;
create function public.save_member_details(p_user uuid,p_nickname text,p_full_name text,p_birth_date date,p_phone text,p_school text,p_pass_year integer,p_research_consent boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into profiles(user_id,nickname) values(p_user,p_nickname)
 on conflict(user_id) do update set nickname=excluded.nickname,updated_at=now();
 insert into member_details(user_id,full_name,birth_date,phone,school,pass_year,research_consent,research_consented_at)
 values(p_user,p_full_name,p_birth_date,p_phone,p_school,p_pass_year,p_research_consent,case when p_research_consent then now() end)
 on conflict(user_id) do update set full_name=excluded.full_name,birth_date=excluded.birth_date,phone=excluded.phone,school=excluded.school,pass_year=excluded.pass_year,research_consent=excluded.research_consent,
 research_consented_at=case when excluded.research_consent then coalesce(member_details.research_consented_at,now()) end,updated_at=now();
end $$;
revoke all on function public.save_member_details(uuid,text,text,date,text,text,integer,boolean) from public,anon,authenticated;
grant execute on function public.save_member_details(uuid,text,text,date,text,text,integer,boolean) to service_role;
alter table public.career_mail_deliveries add column reply_status text not null default 'unknown' check(reply_status in ('unknown','received','none')),
 add column reply_recorded_at timestamptz;
-- Durable one-time review notification. Separate from actual application delivery.
create table public.career_review_notices (
 application_id uuid primary key references public.career_applications(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','unknown','cancelled')),
 payload jsonb, claimed_at timestamptz, sent_at timestamptz, created_at timestamptz not null default now()
);
alter table public.career_review_notices enable row level security;
revoke all on public.career_review_notices from public,anon,authenticated;
grant all on public.career_review_notices to service_role;
create function public.career_pending_review_notices() returns table(id uuid,user_id uuid)
language sql security definer set search_path=public as $$
 select a.id,a.user_id from career_applications a
 join career_rules r on r.user_id=a.user_id and r.enabled
 join job_postings j on j.id=a.posting_id
 where a.status='review' and a.origin='rule' and a.snapshot->>'flow'='uploaded-resume-v1'
 and j.removed_at is null and not coalesce(j.is_expired,false)
 and not exists(select 1 from career_review_notices n where n.application_id=a.id)
 order by a.created_at limit 20;
$$;
revoke all on function public.career_pending_review_notices() from public,anon,authenticated;
grant execute on function public.career_pending_review_notices() to service_role;
notify pgrst,'reload schema';
commit;
