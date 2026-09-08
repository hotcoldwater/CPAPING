-- 댓글과 신고 (Phase 5 — 커뮤니티 1)
--
-- 댓글 테이블 하나로 공고·법인·게시판 글을 모두 받는다(target_type 만 다르다).
-- 신고·임시조치·운영자 삭제가 한 곳에서 처리되기 위해서다.
--
-- 약관이 코드에 요구하는 것:
--   §6  운영자는 어떤 댓글이든 숨기고 지울 수 있다(status) · 연락처 금지(CHECK)
--   §7  신고가 들어오면 즉시 비공개(트리거) → 운영자가 30일 안에 처리 → 통지
--   §10 탈퇴해도 댓글은 남고 작성자는 "탈퇴한 사용자" (author_id on delete set null)
--
-- Supabase SQL Editor 에서 한 번 실행한다. (프로젝트 dxfnopyinnafuozcqvle)

create table if not exists public.comments (
  id            bigint generated always as identity primary key,
  target_type   text not null check (target_type in ('posting', 'firm', 'post')),
  target_id     text not null,                       -- 공고는 ij_id, 법인은 slug, 글은 id
  parent_id     bigint references public.comments (id) on delete cascade,
  author_id     uuid references auth.users (id) on delete set null,
  body          text not null,
  status        text not null default 'visible'
                check (status in ('visible', 'hidden', 'removed')),
  hidden_reason text,                                -- 'reported' | 'operator'
  created_at    timestamptz not null default now(),
  edited_at     timestamptz,
  admin_notified_at timestamptz,                     -- 크롤러가 운영자에게 알린 시각

  constraint comments_body_len check (char_length(btrim(body)) between 1 and 1000),
  -- 담당자 연락처·개인 연락처 금지 (약관 §6). 화면 검사는 우회할 수 있어 DB 에서도 막는다.
  constraint comments_no_contact check (
    body !~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}'
    and body !~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
  )
);
create index if not exists comments_target_idx on public.comments (target_type, target_id, created_at);
create index if not exists comments_author_idx on public.comments (author_id);
create index if not exists comments_unnotified_idx on public.comments (created_at) where admin_notified_at is null;

comment on table public.comments is
  '댓글. 공고·법인·게시판 공용. 탈퇴한 회원의 댓글은 author_id 가 null 로 남는다.';

-- ---------------------------------------------------------------------------
-- 쓰기 조건: 가입을 마친 회원(닉네임 있음 + 인증된 이메일)만, 10분에 5개까지.
-- RLS 는 "내 이름으로만" 을 보장하고, 이 트리거가 "자격" 을 본다.
-- ---------------------------------------------------------------------------
create or replace function public.comments_before_insert()
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
  if (select count(*) from public.comments c
       where c.author_id = new.author_id and c.created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'rate_limited';
  end if;
  new.status := 'visible';          -- 사용자는 상태를 정하지 못한다
  new.hidden_reason := null;
  new.body := btrim(new.body);
  return new;
end;
$$;
drop trigger if exists comments_before_insert on public.comments;
create trigger comments_before_insert
  before insert on public.comments
  for each row execute function public.comments_before_insert();

-- 수정은 본문만. 수정 시각을 남긴다.
create or replace function public.comments_before_update()
returns trigger language plpgsql as $$
begin
  if new.body <> old.body then
    new.body := btrim(new.body);
    new.edited_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists comments_before_update on public.comments;
create trigger comments_before_update
  before update on public.comments
  for each row execute function public.comments_before_update();

-- ---------------------------------------------------------------------------
-- 신고. 들어오는 즉시 댓글을 비공개로 돌린다(임시조치, 약관 §7).
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id            bigint generated always as identity primary key,
  comment_id    bigint not null references public.comments (id) on delete cascade,
  reporter_id   uuid references auth.users (id) on delete set null,
  reason        text not null check (reason in ('defamation', 'privacy', 'ad', 'abuse', 'other')),
  detail        text check (detail is null or char_length(detail) <= 500),
  status        text not null default 'open' check (status in ('open', 'kept', 'removed')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  admin_notified_at timestamptz,
  constraint reports_once unique (comment_id, reporter_id)
);
create index if not exists reports_open_idx on public.reports (created_at) where status = 'open';

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
  update public.comments
     set status = 'hidden', hidden_reason = 'reported'
   where id = new.comment_id and status = 'visible';
  return new;
end;
$$;
drop trigger if exists reports_after_insert on public.reports;
create trigger reports_after_insert
  after insert on public.reports
  for each row execute function public.reports_after_insert();

-- ---------------------------------------------------------------------------
-- 공개 뷰. 보이는 댓글 + 닉네임만 내보낸다. profiles 자체는 비공개로 남는다.
-- 뷰는 소유자 권한으로 돈다(security_invoker 아님) — 그래서 anon 이 읽을 수 있다.
-- 숨김 댓글은 본문을 비우고 자리만 남긴다("신고되어 검토 중").
-- ---------------------------------------------------------------------------
drop view if exists public.comments_public;
create view public.comments_public as
  select c.id, c.target_type, c.target_id, c.parent_id, c.status,
         case when c.status = 'hidden' then null else c.body end as body,
         c.created_at, c.edited_at,
         (c.author_id is null) as author_left,
         case when c.author_id is null then '탈퇴한 사용자' else coalesce(p.nickname, '회원') end as nickname,
         (c.author_id is not null and c.author_id = auth.uid()) as mine
    from public.comments c
    left join public.profiles p on p.user_id = c.author_id
   where c.status in ('visible', 'hidden');
grant select on public.comments_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------
alter table public.comments enable row level security;
alter table public.reports  enable row level security;

grant select, delete on public.comments to authenticated;
grant insert (target_type, target_id, parent_id, author_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;
grant all on public.comments to service_role;

grant select on public.reports to authenticated;
grant insert (comment_id, reporter_id, reason, detail) on public.reports to authenticated;
grant all on public.reports to service_role;

drop policy if exists "comments: 내 것 읽기" on public.comments;
create policy "comments: 내 것 읽기" on public.comments for select to authenticated
  using (author_id = auth.uid());
drop policy if exists "comments: 내 이름으로 쓰기" on public.comments;
create policy "comments: 내 이름으로 쓰기" on public.comments for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists "comments: 내 것 고치기" on public.comments;
create policy "comments: 내 것 고치기" on public.comments for update to authenticated
  using (author_id = auth.uid() and status = 'visible')
  with check (author_id = auth.uid());
drop policy if exists "comments: 내 것 지우기" on public.comments;
create policy "comments: 내 것 지우기" on public.comments for delete to authenticated
  using (author_id = auth.uid());

drop policy if exists "reports: 내 신고 읽기" on public.reports;
create policy "reports: 내 신고 읽기" on public.reports for select to authenticated
  using (reporter_id = auth.uid());
drop policy if exists "reports: 내 이름으로 신고" on public.reports;
create policy "reports: 내 이름으로 신고" on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());
