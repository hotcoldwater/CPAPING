begin;
alter table career_files drop constraint career_files_kind_check;
alter table career_files add constraint career_files_kind_check check(kind in ('template','document','resume'));
alter table career_rules add column resume_file_id uuid references career_files(id) on delete set null;
alter table career_rules add column applicant_name text check(length(applicant_name) between 1 and 80);
alter table career_rules add column mail_subject_template text check(length(mail_subject_template) between 1 and 200);
alter table career_rules add column mail_body_template text check(length(mail_body_template) between 1 and 10000);

create function career_pause_resume(p_user uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 update career_rules set enabled=false,updated_at=clock_timestamp() where user_id=p_user;
 update career_applications set status='review',reason='이력서 또는 지원 설정이 변경되었습니다. 다시 준비하고 검수해 주세요.',version=version+1,updated_at=clock_timestamp()
 where user_id=p_user and status='queued' and snapshot->>'flow'='uploaded-resume-v1';
end $$;

create function career_upload_resume(p_user uuid,p_name text,p_mime text,p_data text) returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 if length(p_name) not between 1 and 100 or octet_length(p_data) not between 8 and 4000000 or p_mime not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document') then raise exception 'resume_invalid';end if;
 if (select count(*) from career_files where user_id=p_user and kind='resume')>=20 then raise exception 'resume_file_limit';end if;
 insert into career_profiles(user_id) values(p_user) on conflict do nothing;
 perform career_pause_resume(p_user);
 insert into career_files(user_id,name,mime,data_base64,kind) values(p_user,p_name,p_mime,p_data,'resume') returning id into result;
 return result;
end $$;

create function career_save_resume_rule(p_user uuid,p_file uuid,p_name text,p_subject text,p_body text,p_filters jsonb,p_mode text,p_enabled boolean,p_limit integer,p_consent text,p_expected timestamptz)
returns setof career_rules language plpgsql security definer set search_path=public as $$
declare previous career_rules;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 select * into previous from career_rules where user_id=p_user for update;
 if (found and previous.updated_at is distinct from p_expected) or (not found and p_expected is not null) then raise exception 'resume_conflict';end if;
 if not exists(select 1 from career_files where id=p_file and user_id=p_user and kind='resume') then raise exception 'resume_missing';end if;
 if p_mode not in ('auto','review') or p_limit not between 1 and 20 or length(p_name) not between 1 and 80 or length(p_subject) not between 1 and 200 or length(p_body) not between 1 and 10000 then raise exception 'resume_invalid';end if;
 if p_enabled and (not exists(select 1 from career_mail_accounts where user_id=p_user) or (p_mode='auto' and p_consent is distinct from 'resume-auto-v1')) then raise exception 'resume_consent';end if;
 perform career_pause_resume(p_user);
 return query insert into career_rules(user_id,resume_file_id,applicant_name,mail_subject_template,mail_body_template,filters,mode,enabled,daily_limit,consent_version,enabled_since,updated_at)
 values(p_user,p_file,p_name,p_subject,p_body,p_filters,p_mode,p_enabled,p_limit,case when p_mode='auto' then p_consent else null end,clock_timestamp(),clock_timestamp())
 on conflict(user_id) do update set resume_file_id=excluded.resume_file_id,applicant_name=excluded.applicant_name,mail_subject_template=excluded.mail_subject_template,mail_body_template=excluded.mail_body_template,
 filters=excluded.filters,mode=excluded.mode,enabled=excluded.enabled,daily_limit=excluded.daily_limit,consent_version=excluded.consent_version,template_id=null,enabled_since=excluded.enabled_since,updated_at=excluded.updated_at returning *;
end $$;

create function career_delete_resume(p_user uuid,p_file uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 if exists(select 1 from career_rules where user_id=p_user and resume_file_id=p_file) or exists(select 1 from career_applications where user_id=p_user and document_id=p_file) or exists(select 1 from career_mail_deliveries where user_id=p_user and document_id=p_file) then raise exception 'resume_in_use';end if;
 delete from career_files where user_id=p_user and id=p_file and kind='resume';
end $$;

create function career_claim_resume_send() returns setof career_applications language plpgsql security definer set search_path=public as $$
declare app career_applications;
begin
 perform pg_advisory_xact_lock(9142026);
 select * into app from career_applications a where a.status='queued' and a.snapshot->>'flow'='uploaded-resume-v1'
 and exists(select 1 from career_mail_accounts m where m.user_id=a.user_id)
 and (select count(*) from career_applications s where s.user_id=a.user_id and s.status in ('sent','sending','delivery_unknown') and s.updated_at>now()-interval '1 day')<coalesce((select daily_limit from career_rules where user_id=a.user_id),5)
 order by a.created_at for update skip locked limit 1;
 if not found then return;end if;
 return query update career_applications set status='sending',updated_at=now() where id=app.id and status='queued' returning *;
end $$;
revoke all on function career_pause_resume(uuid),career_upload_resume(uuid,text,text,text),career_save_resume_rule(uuid,uuid,text,text,text,jsonb,text,boolean,integer,text,timestamptz),career_delete_resume(uuid,uuid),career_claim_resume_send() from public,anon,authenticated;
grant execute on function career_pause_resume(uuid),career_upload_resume(uuid,text,text,text),career_save_resume_rule(uuid,uuid,text,text,text,jsonb,text,boolean,integer,text,timestamptz),career_delete_resume(uuid,uuid),career_claim_resume_send() to service_role;
notify pgrst,'reload schema';
commit;
