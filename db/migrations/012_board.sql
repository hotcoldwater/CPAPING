-- 게시판 (Phase 6 — 커뮤니티 2). 우선 자유게시판 하나(category = 'free').
--
--   글      posts. 회원만 쓴다(닉네임 + 인증 이메일), 10분 3개, 연락처 금지(약관 §6).
--   댓글    기존 comments 를 그대로 쓴다 — target_type 'post', target_id = posts.id 문자열.
--           대댓글·추천·베스트·신고도 그대로 따라온다.
--   추천    post_votes. comment_votes(010)와 같은 규칙.
--   신고    reports 에 post_id 를 더한다. 댓글 신고와 같은 표, 같은 즉시 임시조치(약관 §7).
--   화면    /board/ 목록, /board/write/ 글쓰기, /board/<id>/ 글. 모두 posts_public 뷰를 읽는다.
--
-- Supabase SQL Editor 에서 한 번 실행한다. (프로젝트 dxfnopyinnafuozcqvle)

-- ---------------------------------------------------------------------------
-- 1. 글
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id            bigint generated always as identity primary key,
  category      text not null default 'free' check (category in ('free')),
  author_id     uuid references auth.users (id) on delete set null,
  title         text not null,
  body          text not null,
  status        text not null default 'visible' check (status in ('visible', 'hidden', 'removed')),
  hidden_reason text,
  vote_count    integer not null default 0,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  admin_notified_at timestamptz,
  constraint posts_title_len check (char_length(btrim(title)) between 2 and 80),
  constraint posts_body_len  check (char_length(btrim(body)) between 1 and 5000),
  constraint posts_no_contact check (
    (title || ' ' || body) !~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}'
    and (title || ' ' || body) !~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
  )
);
create index if not exists posts_list_idx on public.posts (category, status, created_at desc);
create index if not exists posts_author_idx on public.posts (author_id);
create index if not exists posts_unnotified_idx on public.posts (created_at) where admin_notified_at is null;
comment on table public.posts is '게시판 글. 탈퇴한 회원의 글은 author_id 가 null 로 남는다(약관 §10).';

create or replace function public.posts_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  if (select count(*) from public.posts p
       where p.author_id = new.author_id and p.created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'rate_limited';
  end if;
  new.status := 'visible';
  new.hidden_reason := null;
  new.title := btrim(new.title);
  new.body := btrim(new.body);
  return new;
end;
$$;
drop trigger if exists posts_before_insert on public.posts;
create trigger posts_before_insert
  before insert on public.posts
  for each row execute function public.posts_before_insert();

create or replace function public.posts_before_update()
returns trigger language plpgsql as $$
begin
  if new.title <> old.title or new.body <> old.body then
    new.title := btrim(new.title);
    new.body := btrim(new.body);
    new.edited_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists posts_before_update on public.posts;
create trigger posts_before_update
  before update on public.posts
  for each row execute function public.posts_before_update();

alter table public.posts enable row level security;
grant select, delete on public.posts to authenticated;
grant insert (category, author_id, title, body) on public.posts to authenticated;
grant update (title, body) on public.posts to authenticated;
grant all on public.posts to service_role;

drop policy if exists "posts: 내 것 읽기" on public.posts;
create policy "posts: 내 것 읽기" on public.posts for select to authenticated
  using (author_id = auth.uid());
drop policy if exists "posts: 내 이름으로 쓰기" on public.posts;
create policy "posts: 내 이름으로 쓰기" on public.posts for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists "posts: 내 것 고치기" on public.posts;
create policy "posts: 내 것 고치기" on public.posts for update to authenticated
  using (author_id = auth.uid() and status = 'visible')
  with check (author_id = auth.uid());
drop policy if exists "posts: 내 것 지우기" on public.posts;
create policy "posts: 내 것 지우기" on public.posts for delete to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. 글 추천 — comment_votes 와 같은 규칙
-- ---------------------------------------------------------------------------
create table if not exists public.post_votes (
  post_id    bigint not null references public.posts (id) on delete cascade,
  voter_id   uuid   not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, voter_id)
);
create index if not exists post_votes_voter_idx on public.post_votes (voter_id, created_at);

create or replace function public.post_votes_before_insert()
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
  select p.author_id, p.status into target from public.posts p where p.id = new.post_id;
  if not found or target.status <> 'visible' then
    raise exception 'votes_unavailable';
  end if;
  if target.author_id = new.voter_id then
    raise exception 'votes_own';
  end if;
  if (select count(*) from public.post_votes v
       where v.voter_id = new.voter_id and v.created_at > now() - interval '10 minutes')
     + (select count(*) from public.comment_votes v
         where v.voter_id = new.voter_id and v.created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'rate_limited';
  end if;
  return new;
end;
$$;
drop trigger if exists post_votes_before_insert on public.post_votes;
create trigger post_votes_before_insert
  before insert on public.post_votes
  for each row execute function public.post_votes_before_insert();

create or replace function public.post_votes_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set vote_count = vote_count + 1 where id = new.post_id;
    return new;
  end if;
  update public.posts set vote_count = greatest(vote_count - 1, 0) where id = old.post_id;
  return old;
end;
$$;
drop trigger if exists post_votes_after_change on public.post_votes;
create trigger post_votes_after_change
  after insert or delete on public.post_votes
  for each row execute function public.post_votes_after_change();

alter table public.post_votes enable row level security;
grant select, delete on public.post_votes to authenticated;
grant insert (post_id, voter_id) on public.post_votes to authenticated;
grant all on public.post_votes to service_role;
drop policy if exists "post_votes: 내 추천 읽기" on public.post_votes;
create policy "post_votes: 내 추천 읽기" on public.post_votes for select to authenticated
  using (voter_id = auth.uid());
drop policy if exists "post_votes: 내 이름으로 추천" on public.post_votes;
create policy "post_votes: 내 이름으로 추천" on public.post_votes for insert to authenticated
  with check (voter_id = auth.uid());
drop policy if exists "post_votes: 내 추천 취소" on public.post_votes;
create policy "post_votes: 내 추천 취소" on public.post_votes for delete to authenticated
  using (voter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. 신고 — 글도 신고할 수 있게 (댓글 신고와 같은 표·같은 임시조치)
-- ---------------------------------------------------------------------------
alter table public.reports add column if not exists post_id bigint references public.posts (id) on delete cascade;
alter table public.reports alter column comment_id drop not null;
alter table public.reports drop constraint if exists reports_target;
alter table public.reports add constraint reports_target check ((comment_id is null) <> (post_id is null));
create unique index if not exists reports_post_once on public.reports (post_id, reporter_id) where post_id is not null;
grant insert (post_id) on public.reports to authenticated;

create or replace function public.reports_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reporter_id is null or new.reporter_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if new.comment_id is not null then
    update public.comments
       set status = 'hidden', hidden_reason = 'reported'
     where id = new.comment_id and status = 'visible';
  end if;
  if new.post_id is not null then
    update public.posts
       set status = 'hidden', hidden_reason = 'reported'
     where id = new.post_id and status = 'visible';
  end if;
  return new;
end;
$$;
-- 트리거(reports_after_insert)는 008 에서 만든 것이 이 함수를 그대로 가리킨다.

-- ---------------------------------------------------------------------------
-- 4. 글 댓글 — 있는 글, 보이는 글에만 달 수 있다 (010 의 함수에 한 단락 추가)
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
  if new.target_type = 'post' then
    if not exists (select 1 from public.posts p where p.id::text = new.target_id and p.status = 'visible') then
      raise exception 'post_gone';
    end if;
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
      raise exception 'reply_depth';
    end if;
  end if;
  new.status := 'visible';
  new.hidden_reason := null;
  new.body := btrim(new.body);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. 공개 뷰 — 목록·글 화면이 읽는다. 숨긴 글은 제목·본문을 비운다.
-- ---------------------------------------------------------------------------
drop view if exists public.posts_public;
create view public.posts_public as
  select p.id, p.category, p.status,
         case when p.status = 'visible' then p.title else null end as title,
         case when p.status = 'visible' then p.body  else null end as body,
         p.created_at, p.edited_at,
         (p.author_id is null) as author_left,
         case when p.author_id is null then '탈퇴한 사용자' else coalesce(pr.nickname, '회원') end as nickname,
         (p.author_id is not null and p.author_id = auth.uid()) as mine,
         p.vote_count as votes,
         exists (select 1 from public.post_votes v
                  where v.post_id = p.id and v.voter_id = auth.uid()) as voted,
         (select count(*) from public.comments c
           where c.target_type = 'post' and c.target_id = p.id::text and c.status = 'visible')::int as comment_count
    from public.posts p
    left join public.profiles pr on pr.user_id = p.author_id
   where p.status in ('visible', 'hidden');
grant select on public.posts_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. 댓글 수 — 공고 목록·법인 비교표·게시판 목록이 "댓글 N" 을 보여 준다 (운영자 요청 2026-09-10)
-- ---------------------------------------------------------------------------
drop view if exists public.comment_counts;
create view public.comment_counts as
  select c.target_type, c.target_id, count(*)::int as comments
    from public.comments c
   where c.status = 'visible'
   group by c.target_type, c.target_id;
grant select on public.comment_counts to anon, authenticated;
