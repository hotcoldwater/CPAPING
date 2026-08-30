-- CPAPING Phase 1 스키마
-- Supabase SQL Editor 에 그대로 붙여넣어 실행한다.
--
-- 프로젝트 설정 전제:
--   Enable Data API            ON
--   Automatically expose new tables  OFF   ← 새 테이블이 자동 공개되지 않음
--   Enable automatic RLS       ON          ← 새 테이블에 RLS 자동 적용
-- 그래서 아래에서 필요한 권한과 정책을 명시적으로 부여한다.

-- ==========================================================================
-- 채용 공고
-- ==========================================================================
create table if not exists public.job_postings (
  id            bigint generated always as identity primary key,

  -- 출처. 게시판마다 번호 체계가 다르므로 함께 키로 쓴다.
  --   kicpa:trainee = 구인(수습CPA), kicpa:cpa = 구인(CPA)
  source        text not null,
  -- 한공회 상세 조회 ID(ijIdNum). 목록의 '번호'는 글이 삭제되면 밀리는
  -- 표시용 순번이라 키로 쓸 수 없다.
  ij_id         text not null,
  seq           integer,                    -- 게시판 표시 번호 (가변)
  detail_url    text not null,

  -- 공고 내용
  title         text not null,
  company_name  text,
  region        text,
  work_region   text,
  employment_type text,                     -- Full Time / Part Time
  hiring_status text,                       -- 채용중 / 마감
  headcount     text,
  career        text,
  salary        text,
  education     text,
  posted_at     date,
  deadline      date,
  view_count    integer,
  body          text,

  -- 담당자 (공고에 공개된 정보)
  contact_name  text,
  contact_phone text,
  contact_email text,
  homepage      text,

  -- 분류 결과
  is_big4       boolean not null default false,
  big4_name     text,
  posting_type  text,                       -- entry / experienced / partner / ambiguous
  job_category  text,                       -- audit / deal / tax / etc
  job_category_confidence text,             -- high / medium / low
  needs_review  boolean not null default false,
  is_expired    boolean not null default false,
  is_target     boolean not null default false,

  -- 변경 감지 및 수명 관리
  content_hash  text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- 한공회는 등록 1개월이 지난 글을 자동 삭제한다. 게시판에서 사라진
  -- 시점을 기록해 두고 우리 DB 에는 계속 보존한다.
  removed_at    timestamptz,
  notified_at   timestamptz,

  constraint job_postings_source_ij_id_key unique (source, ij_id)
);

create index if not exists job_postings_posted_at_idx
  on public.job_postings (posted_at desc);
create index if not exists job_postings_target_idx
  on public.job_postings (is_target, is_expired, posted_at desc);
create index if not exists job_postings_notify_idx
  on public.job_postings (notified_at) where notified_at is null;

comment on table public.job_postings is
  '한공회 구인 게시판에서 수집한 채용 공고. 원문은 detail_url 로 링크한다.';


-- ==========================================================================
-- 크롤 실행 이력 — 크롤러가 조용히 죽는 것을 감지하기 위한 것
-- ==========================================================================
create table if not exists public.crawl_runs (
  id            bigint generated always as identity primary key,
  board         text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  fetched_count integer not null default 0,   -- 목록에서 본 건수
  new_count     integer not null default 0,   -- 처음 본 건수
  updated_count integer not null default 0,
  notified_count integer not null default 0,
  status        text not null default 'running',  -- running / success / failed
  error         text
);

create index if not exists crawl_runs_started_at_idx
  on public.crawl_runs (started_at desc);


-- ==========================================================================
-- 권한
-- ==========================================================================
-- 공고는 누구나 읽을 수 있어야 웹사이트에서 목록을 보여줄 수 있다.
alter table public.job_postings enable row level security;
alter table public.crawl_runs   enable row level security;

drop policy if exists "공고는 누구나 읽기" on public.job_postings;
create policy "공고는 누구나 읽기"
  on public.job_postings for select
  to anon, authenticated
  using (true);

-- crawl_runs 는 운영 정보이므로 공개하지 않는다 (정책 없음 = 접근 불가).

-- Data API 역할에 필요한 최소 권한만 부여한다.
-- (Automatically expose new tables 가 꺼져 있어 자동으로 붙지 않는다)
grant usage on schema public to anon, authenticated;
grant select on public.job_postings to anon, authenticated;

-- 크롤러는 secret key(service_role)로 접속하며 RLS 를 우회한다.
grant all on public.job_postings to service_role;
grant all on public.crawl_runs   to service_role;
