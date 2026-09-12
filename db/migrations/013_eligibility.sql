-- Phase 1B — 지원 자격 축 분리 + "모든 채용 공고" 알림 옵션 (2026-09-11, docs/growth-roadmap.md 1B)
--
--   결정: 공고가 올라온 게시판(source)과 실제 지원 자격(posting_type)은 별개의 축이다.
--        posting_type 에 mixed(신입·경력 함께 모집) · any(경력 무관) 을 추가한다.
--        직원(audience=staff)·미분류(unknown) 공고까지 받는 "모든 채용 공고" 스위치를 구독자에게
--        추가한다. 기존 구독자는 꺼진 채 시작하고, 켠 시각 이후 first_seen_at 공고만 발송한다.
--
--   1B-1(이 파일): 컬럼·주석. 크롤러가 mixed/any 를 쓰기 시작하고, reclassify.py 로 기존 공고를 재분류한다.
--   1B-2: 알림·회원 화면이 want_all_jobs 를 쓴다.   1B-3: 홈 필터 "직원·기타"·상세·법인 페이지.
--
-- Supabase SQL Editor 에서 한 번 실행한다. (프로젝트 dxfnopyinnafuozcqvle)
-- posting_type 에는 CHECK 제약이 없어(schema.sql) 값 추가에 DDL 이 필요하지 않다. 주석만 갱신한다.

-- ---------------------------------------------------------------------------
-- 1. 공고 — 지원 자격 값 추가 (주석)
-- ---------------------------------------------------------------------------
comment on column public.job_postings.posting_type is
  '지원 자격. entry 신입 / mixed 신입·경력 함께 / any 경력 무관 / experienced 경력 / partner 개업·파트너 / ambiguous 판단 불가. '
  '게시판(source)과 별개의 축이다. 수습 게시판은 혼합·무관·판단 불가도 알림 대상.';

-- ---------------------------------------------------------------------------
-- 2. 구독 — 직원·미분류까지 모든 채용 공고를 받을지 (기본 꺼짐)
-- ---------------------------------------------------------------------------
alter table public.subscribers
  add column if not exists want_all_jobs       boolean not null default false,
  add column if not exists want_all_jobs_since timestamptz;

comment on column public.subscribers.want_all_jobs is
  '한공회 채용 게시판의 직원(audience=staff)·미분류(unknown) 공고까지 받는다. 기존 구독자는 꺼진 채 시작한다.';
comment on column public.subscribers.want_all_jobs_since is
  '스위치를 켠 시각. 이 시각 이후 first_seen_at 인 직원·미분류 공고만 보낸다 — 켜는 순간 과거 공고가 한꺼번에 나가지 않게. 끄면 null.';
