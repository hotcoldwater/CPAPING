-- Additive public recruitment content. Existing access policies remain unchanged.
begin;
alter table public.job_postings
  add column if not exists source_content jsonb,
  add column if not exists content_fetched_at timestamptz;
comment on column public.job_postings.source_content is
  'Public source recruitment document: allowlisted content tree, images, contacts and attachment links. Never raw executable HTML.';
comment on column public.job_postings.content_fetched_at is
  'Time the source recruitment content was successfully collected; separate from list last_seen_at.';
notify pgrst, 'reload schema';
commit;
