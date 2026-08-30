-- 담당자 개인정보 컬럼 제거
--
-- 한공회 공고에는 담당자 이름, 개인 휴대폰 번호, 개인 이메일 주소가 적혀
-- 있다. 게시판이 공개돼 있다고 해도 우리가 이를 따로 수집·보관하고 알림
-- 메일로 재배포하는 것은 성격이 다르다. 수집 자체를 그만두기로 했다.
--
-- 값은 이미 NULL 로 지웠고, 이 스크립트는 컬럼을 완전히 없앤다.
-- Supabase SQL Editor 에서 한 번 실행한다.

alter table public.job_postings drop column if exists contact_name;
alter table public.job_postings drop column if exists contact_phone;
alter table public.job_postings drop column if exists contact_email;
