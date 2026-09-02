-- 상장사 감사 고객
--
-- 회계법인 사업보고서에는 고객사 명단이 없다. 상장사 쪽 사업보고서의
-- 'V. 회계감사인의 감사의견 등' 절을 모아 뒤집은 값이다.
--
-- Supabase SQL Editor 에서 한 번 실행한다.

create table if not exists public.audit_clients (
  id          bigint generated always as identity primary key,

  -- firms.name 과 같은 표기로 넣는다. 다만 외래키로 묶지 않는다 —
  -- 사업보고서를 내지 않아 firms 에 없는 회계법인도 감사는 한다
  -- (네트워크회계법인이 그렇다). 묶어 두면 그런 곳이 통째로 버려진다.
  firm_name   text not null,

  company     text not null,   -- 상장사 이름
  stock_code  text,
  market      text,            -- '유가' | '코스닥'
  opinion     text,            -- '적정의견' 등

  -- 스팩(기업인수목적회사)은 사업이 없는 껍데기라 감사 업무량이 사업회사와
  -- 비교가 안 된다. 목록에서 뒤로 보내고, 비중이 높을 때만 따로 알린다.
  is_spac     boolean not null default false,

  fiscal_note text,            -- 어느 보고서에서 읽었는지
  updated_at  timestamptz not null default now(),

  constraint audit_clients_key unique (firm_name, company)
);

create index if not exists audit_clients_firm_idx
  on public.audit_clients (firm_name);

comment on table public.audit_clients is
  '상장사가 사업보고서에 적은 회계감사인을 회계법인별로 뒤집은 목록';


-- ==========================================================================
-- 권한 — 공개 자료이므로 누구나 읽을 수 있다
-- ==========================================================================
alter table public.audit_clients enable row level security;

drop policy if exists "audit_clients 는 누구나 읽는다" on public.audit_clients;
create policy "audit_clients 는 누구나 읽는다"
  on public.audit_clients for select
  to anon, authenticated
  using (true);

-- RLS 정책만으로는 부족하다. 테이블 권한을 따로 줘야 한다.
grant select on public.audit_clients to anon, authenticated;
grant all    on public.audit_clients to service_role;
