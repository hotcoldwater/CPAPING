-- 구독을 회원 계정에 연결한다 (2026-09-09 운영자 결정: 메일만 구독하는 기능은 없애고,
-- 알림은 회원가입으로 받는다. 기존 구독자는 그대로 받는다).
--
-- 회원이 가입 마무리에서 "알림 받기" 를 켜면 subscribers 행을 만들고 user_id 를 적는다.
-- 이미 같은 이메일로 구독 중이면 그 행에 user_id 만 적는다. 이메일은 가입 과정에서
-- 인증됐으므로 확인 메일을 다시 보내지 않고 바로 active 다.
--
-- 탈퇴하면 연결된 구독도 함께 지워진다(on delete cascade) — "이메일을 즉시 삭제한다"
-- 는 약속과 어긋나지 않게.
--
-- Supabase SQL Editor 에서 한 번 실행한다.

alter table public.subscribers
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

create unique index if not exists subscribers_user_id_key
  on public.subscribers (user_id) where user_id is not null;

comment on column public.subscribers.user_id is
  '연결된 회원. null 이면 예전 방식(메일만 구독)의 구독자. 탈퇴 시 행이 함께 지워진다';
