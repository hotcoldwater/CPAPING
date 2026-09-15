begin;
alter table public.job_postings
 add column if not exists recruitment_categories text[] not null default '{}',
 add column if not exists company_type text,
 add column if not exists source_categories text[] not null default '{}',
 add column if not exists source_company_type text,
 add column if not exists source_recruit_type text,
 add column if not exists work_types text[] not null default '{}',
 add column if not exists contract_types text[] not null default '{}',
 add column if not exists cpa_preferred boolean not null default false,
 add column if not exists application_methods text[] not null default '{}',
 add column if not exists form_type text not null default 'unknown',
 add column if not exists taxonomy_version integer not null default 0,
 add column if not exists taxonomy_needs_review boolean not null default true,
 add column if not exists taxonomy_reason text;
create index if not exists job_postings_recruitment_categories_idx on public.job_postings using gin(recruitment_categories);
comment on column public.job_postings.source is 'Physical source identity. kicpa:cpa is the shared CPA/general endpoint; source_categories preserves actual menu membership.';
comment on column public.job_postings.recruitment_categories is 'Public browsing only: entry_cpa, experienced_cpa, general. Empty requires review. Does not change delivery eligibility.';
notify pgrst, 'reload schema';
commit;
