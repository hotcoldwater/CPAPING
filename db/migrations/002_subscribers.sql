-- 구독자 테이블 (Phase 2)
--
-- 더블 옵트인을 쓴다. 신청하면 pending 으로 넣고 확인 메일을 보낸 뒤,
-- 링크를 눌러야 active 가 된다. 남의 주소를 함부로 등록하는 것을 막고
-- 스팸 신고를 줄이기 위해서다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.

create table if not exists public.subscribers (
  id                bigint generated always as identity primary key,

  email             text not null,
  -- 대소문자만 다른 중복 신청을 막기 위한 정규화 값
  email_normalized  text not null,

  -- pending(확인 대기) / active(구독 중) / unsubscribed(해지)
  status            text not null default 'pending',

  confirm_token     text not null,
  unsubscribe_token text not null,

  -- 'all' / 'full'(정규직) / 'part'(파트타임). 웹 목록 필터와 같은 값이다.
  employment_filter text not null default 'all',

  created_at            timestamptz not null default now(),
  confirmation_sent_at  timestamptz,
  confirmed_at          timestamptz,
  unsubscribed_at       timestamptz,

  constraint subscribers_email_key unique (email_normalized),
  constraint subscribers_status_check
    check (status in ('pending', 'active', 'unsubscribed')),
  constraint subscribers_filter_check
    check (employment_filter in ('all', 'full', 'part'))
);

create index if not exists subscribers_active_idx
  on public.subscribers (status) where status = 'active';
create index if not exists subscribers_confirm_token_idx
  on public.subscribers (confirm_token);
create index if not exists subscribers_unsubscribe_token_idx
  on public.subscribers (unsubscribe_token);
-- 확인 메일을 아직 못 보낸 건을 크롤러가 찾아 보낸다
create index if not exists subscribers_pending_send_idx
  on public.subscribers (created_at) where confirmation_sent_at is null;

comment on table public.subscribers is
  '알림 구독자. 더블 옵트인을 거쳐 status=active 가 된 사람에게만 발송한다.';


-- 발송 이력 — 같은 공고를 같은 사람에게 두 번 보내지 않기 위한 것
create table if not exists public.notification_logs (
  id            bigint generated always as identity primary key,
  subscriber_id bigint not null references public.subscribers (id) on delete cascade,
  posting_id    bigint not null references public.job_postings (id) on delete cascade,
  sent_at       timestamptz not null default now(),

  constraint notification_logs_unique unique (subscriber_id, posting_id)
);


-- ==========================================================================
-- 권한
-- ==========================================================================
-- 구독자 정보는 공개하지 않는다. RLS 를 켜고 정책을 두지 않으면
-- 공개 키(anon)로는 아무것도 읽거나 쓸 수 없다.
alter table public.subscribers      enable row level security;
alter table public.notification_logs enable row level security;

-- anon / authenticated 에는 권한을 주지 않는다 (grant 자체를 하지 않음).
-- 구독 신청은 Cloudflare Pages Functions 가 secret key 로 대신 처리한다.
grant all on public.subscribers       to service_role;
grant all on public.notification_logs to service_role;
