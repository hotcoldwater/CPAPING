-- 비공개 자소서·지원 작업공간. 013 이후 적용. 공개 키에는 접근 권한을 주지 않는다.
begin;
create table public.career_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null default '{}' check (octet_length(data::text) <= 180000),
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
create table public.career_rules (
 user_id uuid primary key references public.career_profiles(user_id) on delete cascade,
 enabled boolean not null default false,
 mode text not null default 'review' check(mode in ('review','auto')),
 filters jsonb not null default '{}',
 enabled_since timestamptz not null default now(),
 daily_limit integer not null default 5 check(daily_limit between 1 and 20),
 consent_version text,
 template_id uuid,
 updated_at timestamptz not null default now()
);
create table public.career_mail_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 provider text not null check(provider in ('google','microsoft')),
 email text not null,
 token_encrypted text not null,
 connected_at timestamptz not null default now()
);
create table public.career_oauth_states (
 id text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null check(provider in ('google','microsoft')),
 verifier_encrypted text not null,
 expires_at timestamptz not null default now() + interval '10 minutes'
);
create table public.career_files (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.career_profiles(user_id) on delete cascade,
 name text not null,
 mime text not null,
 data_base64 text not null check(octet_length(data_base64) <= 4000000),
 kind text not null check(kind in ('template','document')),
 mapping jsonb not null default '{}',
 verified_mapping jsonb,
 verified_company text,
 verified_at timestamptz,
 created_at timestamptz not null default now()
);
create index career_files_owner on public.career_files(user_id);
alter table public.career_rules add foreign key(template_id) references public.career_files(id) on delete set null;
create table public.career_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.career_profiles(user_id) on delete cascade,
 kind text not null check(kind in ('assist','essay','prepare','export','inspect')),
 input jsonb not null default '{}' check(octet_length(input::text) <= 220000),
 status text not null default 'pending' check(status in ('pending','running','done','failed')),
 result jsonb,
 error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index career_jobs_queue on public.career_jobs(status,created_at);
create index career_jobs_owner on public.career_jobs(user_id,created_at);
create table public.career_applications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.career_profiles(user_id) on delete cascade,
 posting_id bigint not null references public.job_postings(id) on delete cascade,
 -- 끌올 original_id도 묶어 같은 채용에 재지원하지 않는다.
 canonical_posting_id bigint not null references public.job_postings(id),
 origin text not null default 'manual' check(origin in ('manual','rule')),
 status text not null default 'preparing' check(status in ('preparing','review','queued','sending','sent','blocked','cancelled','delivery_unknown','failed')),
 version integer not null default 1,
 snapshot jsonb not null default '{}',
 recipient text,
 subject text,
 body text,
 document_id uuid references public.career_files(id) on delete set null,
 template_id uuid references public.career_files(id) on delete set null,
 reason text,
 provider_message_id text,
 approved_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 sent_at timestamptz,
 unique(user_id,canonical_posting_id)
);
create index career_applications_queue on public.career_applications(status,created_at);
create index career_applications_owner on public.career_applications(user_id,created_at);
-- 지원 데이터는 오직 인증 후 사용자 ID를 강제하는 서버 API에서 읽고 쓴다.
do $$ declare t text; begin
 foreach t in array array['career_profiles','career_rules','career_mail_accounts','career_oauth_states','career_files','career_jobs','career_applications'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- 같은 회원의 동시 요청도 하루 한도 안에 둔다. 성공/실패 모두 시도 비용에 포함.
create function public.career_enqueue(p_user uuid,p_kind text,p_input jsonb)
returns setof public.career_jobs language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(9142030);
 if (select count(*) from career_jobs where created_at > now()-interval '1 day') >= 500 then
  raise exception 'career_site_limit';
 end if;
 if (select count(*) from career_jobs where user_id=p_user and created_at > now()-interval '1 day') >= 30 then
  raise exception 'career_daily_limit';
 end if;
 if (select count(*) from career_jobs where user_id=p_user and status in ('pending','running')) >= 3 then
  raise exception 'career_pending_limit';
 end if;
 return query insert into career_jobs(user_id,kind,input) values(p_user,p_kind,p_input) returning *;
end $$;
create function public.career_claim_job()
returns setof public.career_jobs language sql security definer set search_path=public as $$
 update career_jobs set status='running',updated_at=now() where id=(
 select id from career_jobs where status='pending' order by created_at for update skip locked limit 1
 ) returning *;
$$;
-- 발송은 한 번만 claim한다. 중단된 sending은 재발송하지 않고 결과 불명으로 남긴다.
create function public.career_claim_send()
returns setof public.career_applications language plpgsql security definer set search_path=public as $$
declare app career_applications;
begin
 perform pg_advisory_xact_lock(9142026);
 select * into app from career_applications a where a.status='queued'
  and exists(select 1 from career_mail_accounts m where m.user_id=a.user_id)
  and (select count(*) from career_applications s where s.user_id=a.user_id
       and s.status in ('sent','sending','delivery_unknown') and s.updated_at > now()-interval '1 day')
       < coalesce((select daily_limit from career_rules where user_id=a.user_id),5)
  order by a.created_at for update skip locked limit 1;
 if not found then return; end if;
 return query update career_applications set status='sending',updated_at=now()
  where id=app.id and status='queued' returning *;
end $$;
revoke all on function public.career_enqueue(uuid,text,jsonb), public.career_claim_job(), public.career_claim_send() from public,anon,authenticated;
grant execute on function public.career_enqueue(uuid,text,jsonb), public.career_claim_job(), public.career_claim_send() to service_role;
commit;
