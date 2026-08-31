-- 회계법인 정보
--
-- 공고를 낸 법인은 크롤러가 자동으로 만든다. 재무·인력 자료는 사람이
-- 사업보고서를 보고 채운다. 두 출처가 섞이므로 **컬럼마다 주인을 나눈다.**
-- 크롤러는 자기 컬럼만 건드리고 사람 컬럼은 읽지도 쓰지도 않는다.
-- 그러지 않으면 10분마다 도는 크롤이 손으로 채운 자료를 지워버린다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.

create table if not exists public.firms (
  id            bigint generated always as identity primary key,

  -- 대표 이름. 지점은 여기에 묶는다
  -- ('선진회계법인 대구지점' 도 '선진회계법인' 하나로)
  name          text not null,
  -- 공고에 실제로 나타나는 표기들. 오탈자('대현회게법인')도 여기 담는다
  aliases       text[] not null default '{}',
  -- URL 에 쓰는 값. 한글 그대로 쓴다 (검색어와 일치해 유리하다)
  slug          text not null,

  -- ── 크롤러 소유 ────────────────────────────────────────
  region            text,
  homepage          text,
  first_posted_at   date,
  last_posted_at    date,
  posting_count     integer not null default 0,
  repost_count      integer not null default 0,
  crawler_updated_at timestamptz,

  -- ── 사람 소유 (크롤러가 건드리지 않는다) ──────────────────
  brand             text,      -- 'Forvis Mazars in Korea'
  ceo               text,
  address           text,
  is_listed_auditor boolean,   -- 주권상장법인 감사인 등록 여부
  auditor_reg_no    text,      -- '제34호'
  auditor_reg_date  date,
  data_source       text,      -- '회계법인 사업보고서'
  note              text,
  manual_updated_at timestamptz,

  constraint firms_name_key unique (name),
  constraint firms_slug_key unique (slug)
);

create index if not exists firms_aliases_idx on public.firms using gin (aliases);


-- 연도별 재무·인력. 한 법인에 여러 해가 쌓인다.
create table if not exists public.firm_financials (
  id            bigint generated always as identity primary key,
  firm_id       bigint not null references public.firms (id) on delete cascade,

  fiscal_year   text not null,   -- '2025.08' — 결산월이 법인마다 달라 문자열로 둔다

  revenue       numeric(10, 2),  -- 억원
  revenue_audit numeric(10, 2),
  revenue_tax   numeric(10, 2),
  revenue_deal  numeric(10, 2),
  revenue_other numeric(10, 2),

  cpa_count     integer,
  trainee_count integer,         -- 수습회계사. 지원자가 가장 궁금해하는 값
  partner_count integer,

  constraint firm_financials_year_key unique (firm_id, fiscal_year)
);

create index if not exists firm_financials_firm_idx
  on public.firm_financials (firm_id, fiscal_year);

comment on column public.firm_financials.trainee_count is
  '해당 연도에 채용한 수습회계사 수. 사업보고서 기준';


-- ==========================================================================
-- 권한 — 법인 정보는 공개 자료이므로 누구나 읽을 수 있다
-- ==========================================================================
alter table public.firms            enable row level security;
alter table public.firm_financials  enable row level security;

drop policy if exists "법인 정보는 누구나 읽기" on public.firms;
create policy "법인 정보는 누구나 읽기"
  on public.firms for select to anon, authenticated using (true);

drop policy if exists "재무 정보는 누구나 읽기" on public.firm_financials;
create policy "재무 정보는 누구나 읽기"
  on public.firm_financials for select to anon, authenticated using (true);

grant select on public.firms           to anon, authenticated;
grant select on public.firm_financials to anon, authenticated;
grant all    on public.firms           to service_role;
grant all    on public.firm_financials to service_role;
