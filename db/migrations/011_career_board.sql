-- 경력 공고 확장 — 한공회 구인(CPA) 게시판 수집 (2026-09-09 운영자 결정)
--
--   결정: 경력은 빅4 포함 · 기장·세무대리 등 직원 공고는 제외 · 일반기업의 회계사 공고는 포함 ·
--        알림은 수습 정규직 / 수습 파트타임 / 경력 을 각각 켜고 끈다.
--
--   1단계(이 파일): 공고 표에 대상(audience)·경력 연차 컬럼, 구독 표에 종류 스위치 3개.
--        크롤러는 두 게시판을 매분 수집하되 경력 공고 알림은 아직 보내지 않는다.
--   2단계: 알림·회원 화면이 종류 스위치를 쓴다.   3단계: 홈 탭·/career/·상세 페이지.
--
-- Supabase SQL Editor 에서 한 번 실행한다. (프로젝트 dxfnopyinnafuozcqvle)

-- ---------------------------------------------------------------------------
-- 1. 공고 — 누구를 뽑는 공고인가, 경력 몇 년인가
-- ---------------------------------------------------------------------------
alter table public.job_postings
  add column if not exists audience text
    check (audience is null or audience in ('cpa', 'staff', 'unknown')),
  add column if not exists career_min_years integer,
  add column if not exists career_max_years integer;

comment on column public.job_postings.audience is
  '회계사 대상(cpa) / 직원·기장·세무대리 대상(staff) / 판단 불가(unknown). 수습 게시판은 항상 cpa. '
  'unknown 은 운영자가 확인해 cpa 로 바꾸고 is_target 을 켠다.';
comment on column public.job_postings.career_min_years is '공고가 요구하는 경력 연차 하한 (예: "3~5년" → 3, "5년 이상" → 5)';
comment on column public.job_postings.career_max_years is '경력 연차 상한 (예: "3~5년" → 5). 상한이 없으면 null';

-- 게시판별 목록·알림 조회가 늘어난다
create index if not exists job_postings_source_target_idx
  on public.job_postings (source, is_target, is_expired, posted_at desc);

-- ---------------------------------------------------------------------------
-- 2. 구독 — 어떤 종류의 공고를 받을지 (셋 다 끄면 아무것도 안 받는다)
-- ---------------------------------------------------------------------------
alter table public.subscribers
  add column if not exists want_trainee_full boolean not null default true,
  add column if not exists want_trainee_part boolean not null default true,
  add column if not exists want_career       boolean not null default false;

comment on column public.subscribers.want_trainee_full is '수습 정규직 공고 알림';
comment on column public.subscribers.want_trainee_part is '수습 파트타임 공고 알림';
comment on column public.subscribers.want_career is '경력 공고 알림(구인(CPA) 게시판). 기존 구독자는 꺼진 채 시작한다';

-- 기존 고용형태 조건을 스위치로 옮긴다. 2단계 배포 전까지는 크롤러가 employment_filter 를 계속 쓴다.
update public.subscribers set want_trainee_part = false where employment_filter = 'full';
update public.subscribers set want_trainee_full = false where employment_filter = 'part';
