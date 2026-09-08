-- 회원 프로필 (Phase 3)
--
-- 계정은 Supabase Auth(auth.users)가 갖고, 우리 서비스가 붙이는 정보만 여기 둔다.
-- 지금은 닉네임 하나다. 뱃지(기수·법인·회사)는 인증 정책이 확정되면 컬럼으로 붙인다.
--
-- 회원 식별은 언제나 auth.users.id 다. 카카오 로그인은 이메일이 없이 들어오므로
-- 이메일을 키로 쓰면 안 된다. 온보딩 상태는 컬럼으로 두지 않고 세 가지 사실로
-- 계산한다 — 이메일이 있고 확인됐는가(auth), 닉네임이 있는가(profiles).
-- 상태를 캐시하면 트리거로 맞춰야 하고, 어긋나면 사용자가 온보딩에 갇힌다.
--
-- Supabase SQL Editor 에서 한 번 실행한다. (프로젝트 dxfnopyinnafuozcqvle)

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  -- 온보딩을 마치기 전에는 null. 약관 §4: 2~12자, 다른 회원과 같을 수 없음.
  nickname    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_nickname_len
    check (nickname is null
           or (char_length(nickname) between 2 and 12 and nickname = btrim(nickname))),
  -- 운영자·공식 사칭 문구는 DB 에서도 막는다. 화면 검사는 우회할 수 있다.
  constraint profiles_nickname_reserved
    check (nickname is null or nickname !~* '(운영자|관리자|cpaping|공식|admin|official)')
);

-- 대소문자만 다른 닉네임은 같은 것으로 본다
create unique index if not exists profiles_nickname_key
  on public.profiles (lower(nickname));

comment on table public.profiles is
  '회원 프로필. 계정 자체는 auth.users. 식별자는 user_id 이고 이메일은 키가 아니다.';

-- ---------------------------------------------------------------------------
-- auth.users 에 사용자가 생기면 profiles 행을 만든다.
-- security definer 라야 auth 스키마의 트리거에서 public 테이블에 쓸 수 있다.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이미 있는 계정(있다면)에도 행을 만들어 둔다
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 권한. 본인 행만 읽고 고친다. 행 추가는 트리거만 한다(사용자 insert 정책 없음).
-- anon 에는 아무것도 주지 않는다 — 닉네임 공개 조회는 댓글 Phase 에서 뷰로 연다.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

grant select, update (nickname) on public.profiles to authenticated;
grant all on public.profiles to service_role;

drop policy if exists "profiles: 본인 읽기" on public.profiles;
create policy "profiles: 본인 읽기"
  on public.profiles for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "profiles: 본인 수정" on public.profiles;
create policy "profiles: 본인 수정"
  on public.profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
