begin;
-- Toggle the saved preparation without overwriting its file, templates or draft.
create function career_set_resume_automation(p_user uuid,p_enabled boolean,p_mode text,p_consent text,p_expected timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous career_rules; saved career_rules; draft career_resume_drafts; changed_at timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1701));
 select * into previous from career_rules where user_id=p_user for update;
 if not found or previous.updated_at is distinct from p_expected then raise exception 'resume_conflict';end if;
 if previous.resume_file_id is null then raise exception 'resume_missing';end if;
 if p_enabled is null or p_mode is null or p_mode not in ('auto','review') then raise exception 'resume_invalid';end if;
 if p_enabled and (not exists(select 1 from career_mail_accounts where user_id=p_user) or
  (p_mode='auto' and p_consent is distinct from 'resume-auto-v1' and (previous.mode<>'auto' or previous.consent_version is distinct from 'resume-auto-v1'))) then raise exception 'resume_consent';end if;
 if previous.enabled is distinct from p_enabled or previous.mode is distinct from p_mode then
  -- Also invalidates snapshots of work claimed just before this transaction.
  changed_at:=clock_timestamp();
  update career_applications set status='review',reason=case when p_enabled then '발송 방식이 변경되었습니다. 현재 이력서로 다시 준비하고 검수해 주세요.' else '자동 지원을 꺼서 발송 대기를 멈췄습니다.' end,version=version+1,updated_at=changed_at
   where user_id=p_user and status='queued' and snapshot->>'flow'='uploaded-resume-v1';
  update career_rules set enabled=p_enabled,mode=p_mode,updated_at=changed_at,
   enabled_since=case when p_enabled and not previous.enabled then changed_at else previous.enabled_since end,
   consent_version=case when p_mode='auto' then coalesce(p_consent,previous.consent_version) else null end
   where user_id=p_user returning * into saved;
  -- Only rebase a draft that was based on exactly this saved rule; stale drafts still conflict.
  update career_resume_drafts set data=data||jsonb_build_object('enabled',p_enabled,'mode',p_mode),base_rule_updated_at=saved.updated_at,version=version+1,updated_at=changed_at
   where user_id=p_user and base_rule_updated_at is not distinct from previous.updated_at;
 else saved:=previous;end if;
 select * into draft from career_resume_drafts where user_id=p_user;
 return jsonb_build_object('rule',to_jsonb(saved),'draft',case when draft.user_id is null then null else to_jsonb(draft) end);
end $$;
revoke all on function career_set_resume_automation(uuid,boolean,text,text,timestamptz) from public,anon,authenticated;
grant execute on function career_set_resume_automation(uuid,boolean,text,text,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
