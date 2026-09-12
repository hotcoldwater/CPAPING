-- SQL 014 이후. 게시판 SQL 015와 독립적이다.
begin;
create table public.career_mail_deliveries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 application_id uuid references public.career_applications(id) on delete cascade,
 application_version integer,
 document_id uuid references public.career_files(id) on delete set null,
 test_key text unique,
 company text not null,
 recipient text not null,
 subject text not null,
 body text not null,
 mode text not null check(mode in ('review','auto','test')),
 status text not null default 'draft' check(status in ('draft','sending','sent','failed','delivery_unknown')),
 tracking_hash text unique check(tracking_hash ~ '^[a-f0-9]{64}$'),
 first_open_at timestamptz,
 provider_message_id text,
 reason text,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 unique(application_id,application_version)
);
create index career_mail_deliveries_owner on public.career_mail_deliveries(user_id,created_at desc,id);
alter table public.career_mail_deliveries enable row level security;
revoke all on public.career_mail_deliveries from public,anon,authenticated;
grant all on public.career_mail_deliveries to service_role;
create function public.career_record_open(p_hash text) returns void
language sql security definer set search_path=public as $$
 update career_mail_deliveries set first_open_at=now()
 where tracking_hash=p_hash and status in ('sending','sent','delivery_unknown') and first_open_at is null;
$$;
revoke all on function public.career_record_open(text) from public,anon,authenticated;
grant execute on function public.career_record_open(text) to service_role;
notify pgrst, 'reload schema';
commit;
