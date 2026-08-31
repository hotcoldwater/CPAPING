-- 끌올(재등록) 추적
--
-- 한공회는 등록 1개월이 지난 글을 자동으로 지운다. 채용이 안 된 법인은
-- 같은 자리를 다시 올리는데, 지원자 입장에서는 "새로 열린 자리"와
-- "두 달째 안 채워지는 자리"가 전혀 다른 정보다.
--
-- 우리 DB 는 사라진 공고도 removed_at 만 남기고 보존하므로, 새 공고가
-- 들어올 때 같은 법인의 유사 공고를 찾아 연결할 수 있다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.

alter table public.job_postings
  -- 이 공고가 재등록이라면, 최초 공고의 id
  add column if not exists original_id bigint
    references public.job_postings (id) on delete set null,
  -- 최초 공고의 등록일. 화면에 "끌올 · 최초 08.03" 으로 보여준다
  add column if not exists original_posted_at date,
  -- 몇 번째 재등록인지 (최초 공고는 0)
  add column if not exists repost_count integer not null default 0;

-- 재등록 판정 시 같은 법인의 과거 공고를 찾는다
create index if not exists job_postings_company_idx
  on public.job_postings (source, company_name);

-- 게시판에서 내려간 공고를 최근순으로 보여주기 위한 인덱스
create index if not exists job_postings_removed_idx
  on public.job_postings (removed_at desc) where removed_at is not null;

comment on column public.job_postings.original_id is
  '재등록(끌올)이면 최초 공고의 id. 최초 공고면 null';
