begin;
-- NULL means no CPAPING daily quota. Keep legacy non-resume rule limits intact.
alter table career_rules alter column daily_limit drop not null;
-- Do not change updated_at: existing reviewed application snapshots remain valid.
update career_rules set daily_limit=null where resume_file_id is not null;
create or replace function career_save_resume_rule(p_user uuid,p_file uuid,p_name text,p_subject text,p_body text,p_filters jsonb,p_mode text,p_enabled boolean,p_limit integer,p_consent text,p_expected timestamptz)
returns setof career_rules language plpgsql security definer set search_path=public as $$
declare previous career_rules;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 select * into previous from career_rules where user_id=p_user for update;
 if (found and previous.updated_at is distinct from p_expected) or (not found and p_expected is not null) then raise exception 'resume_conflict';end if;
 if not exists(select 1 from career_files where id=p_file and user_id=p_user and kind='resume') then raise exception 'resume_missing';end if;
 if p_mode not in ('auto','review') or length(p_name) not between 1 and 80 or length(p_subject) not between 1 and 200 or length(p_body) not between 1 and 10000 then raise exception 'resume_invalid';end if;
 if p_enabled and (not exists(select 1 from career_mail_accounts where user_id=p_user) or (p_mode='auto' and p_consent is distinct from 'resume-auto-v1')) then raise exception 'resume_consent';end if;
 perform career_pause_resume(p_user);
 return query insert into career_rules(user_id,resume_file_id,applicant_name,mail_subject_template,mail_body_template,filters,mode,enabled,daily_limit,consent_version,enabled_since,updated_at)
 values(p_user,p_file,p_name,p_subject,p_body,p_filters,p_mode,p_enabled,null,case when p_mode='auto' then p_consent else null end,clock_timestamp(),clock_timestamp())
 on conflict(user_id) do update set resume_file_id=excluded.resume_file_id,applicant_name=excluded.applicant_name,mail_subject_template=excluded.mail_subject_template,mail_body_template=excluded.mail_body_template,
 filters=excluded.filters,mode=excluded.mode,enabled=excluded.enabled,daily_limit=excluded.daily_limit,consent_version=excluded.consent_version,template_id=null,enabled_since=excluded.enabled_since,updated_at=excluded.updated_at returning *;
end $$;

create or replace function career_claim_resume_send() returns setof career_applications language plpgsql security definer set search_path=public as $$
declare app career_applications;
begin
 perform pg_advisory_xact_lock(9142026);
 select * into app from career_applications a where a.status='queued' and a.snapshot->>'flow'='uploaded-resume-v1'
 and exists(select 1 from career_mail_accounts m where m.user_id=a.user_id)
 order by a.created_at for update skip locked limit 1;
 if not found then return;end if;
 return query update career_applications set status='sending',updated_at=now() where id=app.id and status='queued' returning *;
end $$;
revoke all on function career_save_resume_rule(uuid,uuid,text,text,text,jsonb,text,boolean,integer,text,timestamptz),career_claim_resume_send() from public,anon,authenticated;
grant execute on function career_save_resume_rule(uuid,uuid,text,text,text,jsonb,text,boolean,integer,text,timestamptz),career_claim_resume_send() to service_role;
notify pgrst,'reload schema';
commit;
