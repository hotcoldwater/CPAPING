begin;
-- Refresh classification when the crawler changes application evidence, not view counts.
create function career_invalidate_analysis() returns trigger language plpgsql set search_path=public as $$
begin
 if (to_jsonb(old)->'body') is distinct from (to_jsonb(new)->'body') or
 (to_jsonb(old)->'source_content') is distinct from (to_jsonb(new)->'source_content') or
 (to_jsonb(old)->'content_hash') is distinct from (to_jsonb(new)->'content_hash') then new.application_analysis=null;end if;
 return new;
end $$;
create trigger career_analysis_refresh before update on job_postings for each row execute function career_invalidate_analysis();
revoke all on function career_invalidate_analysis() from public,anon,authenticated;
-- Draft references must belong to the author, even before committing the pair.
create function career_validate_draft_pair() returns trigger language plpgsql set search_path=public as $$
begin
 if new.data->>'resume_docx_file_id' is not null and not exists(select 1 from career_files where id=(new.data->>'resume_docx_file_id')::uuid and user_id=new.user_id and kind='resume' and mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document') then raise exception 'resume_pair_missing';end if;
 return new;
end $$;
create trigger career_draft_pair before insert or update on career_resume_drafts for each row execute function career_validate_draft_pair();
revoke all on function career_validate_draft_pair() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
