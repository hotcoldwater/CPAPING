-- 댓글 추천·베스트, 대댓글, 한공회 조회수 이력 (Phase 5 — 커뮤니티 1)
--
--   추천   comment_votes 한 사람 한 번(PK). 회원만, 자기 댓글 불가, 보이는 댓글만, 10분 30회.
--          comments.vote_count 는 트리거가 유지한다. 비추천은 없다(법인 댓글의 집단 공격 방지).
--   베스트  화면(comments.js)이 정한다 — 추천 10개 이상인 원댓글 중 상위 3개. 기준값은 상수.
--   대댓글  parent_id 한 단계만. 부모와 같은 대상이어야 한다. 답글이 달린 댓글을 지우면
--          자리("삭제된 댓글")만 남기고 답글은 보존한다 — 남의 답글이 함께 사라지지 않게.
--   조회수  크롤러가 하루 1행씩 ij_id 별 조회수를 남긴다(KST). "오늘 +N" 과 인기 공고에 쓴다.
--
-- Supabase SQL Editor 에서 한 번 실행한다. (프로젝트 dxfnopyinnafuozcqvle)

-- ---------------------------------------------------------------------------
-- 1. 추천
-- ---------------------------------------------------------------------------
alter table public.comments add column if not exists vote_count integer not null default 0;

create table if not exists public.comment_votes (
  comment_id bigint not null references public.comments (id) on delete cascade,
  voter_id   uuid   not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, voter_id)
);
create index if not exists comment_votes_voter_idx on public.comment_votes (voter_id, created_at);
comment on table public.comment_votes is '댓글 추천. 한 사람이 한 댓글에 한 번. 취소는 행 삭제.';

create or replace function public.comment_votes_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
begin
  if new.voter_id is null or new.voter_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'email', '') = '' then
    raise exception 'email_required';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = new.voter_id and p.nickname is not null) then
    raise exception 'profile_incomplete';
  end if;
  select c.author_id, c.status into target from public.comments c where c.id = new.comment_id;
  if not found or target.status <> 'visible' then
    raise exception 'votes_unavailable';
  end if;
  if target.author_id = new.voter_id then
    raise exception 'votes_own';
  end if;
  if (select count(*) from public.comment_votes v
       where v.voter_id = new.voter_id and v.created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'rate_limited';
  end if;
  return new;
end;
$$;
drop trigger if exists comment_votes_before_insert on public.comment_votes;
create trigger comment_votes_before_insert
  before insert on public.comment_votes
  for each row execute function public.comment_votes_before_insert();

-- 추천 수는 여기서만 바뀐다. 사용자에게는 comments.vote_count 쓰기 권한이 없다.
create or replace function public.comment_votes_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.comments set vote_count = vote_count + 1 where id = new.comment_id;
    return new;
  end if;
  update public.comments set vote_count = greatest(vote_count - 1, 0) where id = old.comment_id;
  return old;
end;
$$;
drop trigger if exists comment_votes_after_change on public.comment_votes;
create trigger comment_votes_after_change
  after insert or delete on public.comment_votes
  for each row execute function public.comment_votes_after_change();

alter table public.comment_votes enable row level security;
grant select, delete on public.comment_votes to authenticated;
grant insert (comment_id, voter_id) on public.comment_votes to authenticated;
grant all on public.comment_votes to service_role;

drop policy if exists "votes: 내 추천 읽기" on public.comment_votes;
create policy "votes: 내 추천 읽기" on public.comment_votes for select to authenticated
  using (voter_id = auth.uid());
drop policy if exists "votes: 내 이름으로 추천" on public.comment_votes;
create policy "votes: 내 이름으로 추천" on public.comment_votes for insert to authenticated
  with check (voter_id = auth.uid());
drop policy if exists "votes: 내 추천 취소" on public.comment_votes;
create policy "votes: 내 추천 취소" on public.comment_votes for delete to authenticated
  using (voter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. 대댓글 — 쓰기 자격 검사(008)에 부모 검사를 더한다
-- ---------------------------------------------------------------------------
create or replace function public.comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent record;
begin
  if new.author_id is null or new.author_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'email', '') = '' then
    raise exception 'email_required';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = new.author_id and p.nickname is not null) then
    raise exception 'profile_incomplete';
  end if;
  if (select count(*) from public.comments c
       where c.author_id = new.author_id and c.created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'rate_limited';
  end if;
  if new.parent_id is not null then
    select c.target_type, c.target_id, c.parent_id, c.status into parent
      from public.comments c where c.id = new.parent_id;
    if not found or parent.status = 'removed' then
      raise exception 'reply_parent_gone';
    end if;
    if parent.target_type <> new.target_type or parent.target_id <> new.target_id then
      raise exception 'reply_target_mismatch';
    end if;
    if parent.parent_id is not null then
      raise exception 'reply_depth';        -- 답글의 답글은 없다. 같은 부모에 붙인다.
    end if;
  end if;
  new.status := 'visible';          -- 사용자는 상태를 정하지 못한다
  new.hidden_reason := null;
  new.body := btrim(new.body);
  return new;
end;
$$;
-- 트리거(comments_before_insert)는 008 에서 만든 것이 그대로 이 함수를 가리킨다.

-- 답글이 달린 댓글은 지우지 않고 자리만 남긴다. 본문은 지운다(작성자가 지우길 원했다).
create or replace function public.comments_before_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.comments r where r.parent_id = old.id) then
    update public.comments
       set status = 'removed', hidden_reason = null, body = '(삭제됨)'
     where id = old.id;
    return null;                       -- 실제 삭제는 하지 않는다
  end if;
  return old;
end;
$$;
drop trigger if exists comments_before_delete on public.comments;
create trigger comments_before_delete
  before delete on public.comments
  for each row execute function public.comments_before_delete();

-- ---------------------------------------------------------------------------
-- 3. 공개 뷰 — 추천 수·내가 추천했는지, 답글이 남은 삭제 댓글의 자리
-- ---------------------------------------------------------------------------
drop view if exists public.comments_public;
create view public.comments_public as
  select c.id, c.target_type, c.target_id, c.parent_id, c.status,
         case when c.status = 'visible' then c.body else null end as body,
         c.created_at, c.edited_at,
         (c.author_id is null) as author_left,
         case when c.status = 'removed' then ''
              when c.author_id is null then '탈퇴한 사용자'
              else coalesce(p.nickname, '회원') end as nickname,
         (c.author_id is not null and c.author_id = auth.uid()) as mine,
         c.vote_count as votes,
         exists (select 1 from public.comment_votes v
                  where v.comment_id = c.id and v.voter_id = auth.uid()) as voted
    from public.comments c
    left join public.profiles p on p.user_id = c.author_id
   where c.status in ('visible', 'hidden')
      or (c.status = 'removed'
          and exists (select 1 from public.comments r
                       where r.parent_id = c.id and r.status in ('visible', 'hidden')));
grant select on public.comments_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 한공회 조회수 이력 — 크롤러(service_role)가 쓰고, 누구나 읽는다
-- ---------------------------------------------------------------------------
create table if not exists public.posting_view_snapshots (
  ij_id      text not null,
  day        date not null,                 -- 한국 시간 기준 날짜
  view_count integer not null,
  updated_at timestamptz not null default now(),
  primary key (ij_id, day)
);
comment on table public.posting_view_snapshots is
  '공고별 하루 1행. 그날 마지막으로 본 한공회 조회수. "오늘 +N" 과 인기 공고 계산에 쓴다.';

alter table public.posting_view_snapshots enable row level security;
grant select on public.posting_view_snapshots to anon, authenticated;
grant all on public.posting_view_snapshots to service_role;
drop policy if exists "snapshots: 누구나 읽기" on public.posting_view_snapshots;
create policy "snapshots: 누구나 읽기" on public.posting_view_snapshots for select to anon, authenticated
  using (true);
