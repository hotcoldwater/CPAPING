-- 지역 필터 (Phase 2)
--
-- 구독 필터가 고용형태 하나뿐이라 24명 중 23명이 '전체' 였다. 사실상
-- 필터가 없는 것과 같았고, 공고 1건이 뜰 때마다 구독자 전원에게 나갔다.
--
-- 한공회의 지역 값은 자유 텍스트다 — '서울', '서울 전체', '서울 강남구',
-- '경남 창원시 성산구', '지역무관' 이 모두 나온다. 크롤러가 시·도로 묶어
-- region_group 에 넣고, 필터는 그 값만 본다. 정규화 규칙은 crawler/regions.py
-- 한 곳에만 둔다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.

-- capital(수도권: 서울·경기·인천) / local(그 외) / any(지역무관·판정 불가)
alter table public.job_postings
  add column if not exists region_group text not null default 'any';

alter table public.job_postings
  drop constraint if exists job_postings_region_group_check;
alter table public.job_postings
  add constraint job_postings_region_group_check
  check (region_group in ('capital', 'local', 'any'));

-- 알림 대상을 고를 때 고용형태·마감과 함께 걸린다
create index if not exists job_postings_region_group_idx
  on public.job_postings (region_group)
  where is_target and not is_expired;

comment on column public.job_postings.region_group is
  '구독 필터용 지역 묶음. crawler/regions.py 의 group() 이 정한다';


-- 구독자가 고른 지역. employment_filter 와 같은 방식이다.
-- 'any'(지역무관) 공고는 어느 필터에도 걸리지 않고 모두에게 나간다 —
-- 지역 판정이 틀려서 공고를 감추면 지원자가 기회를 놓친다.
alter table public.subscribers
  add column if not exists region_filter text not null default 'all';

alter table public.subscribers
  drop constraint if exists subscribers_region_filter_check;
alter table public.subscribers
  add constraint subscribers_region_filter_check
  check (region_filter in ('all', 'capital', 'local'));

comment on column public.subscribers.region_filter is
  'all / capital(수도권만) / local(지방만). 지역무관 공고는 항상 포함된다';
