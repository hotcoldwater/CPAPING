begin;
-- Removing firm/region/revenue restrictions broadens the audience: require a fresh save.
-- Paused AI/template rules are outside this migration.
do $$
declare r record; employment jsonb;
begin
 for r in select user_id,filters from career_rules
  where resume_file_id is not null and filters->>'scope' is distinct from 'trainee-employment-v1'
 loop
  perform career_pause_resume(r.user_id);
  select jsonb_agg(value order by ord) into employment
   from (values ('Full Time',1),('Part Time',2)) as choices(value,ord)
   where jsonb_typeof(r.filters->'employment')='array' and r.filters->'employment' ? value;
  update career_rules set filters=jsonb_build_object('scope','trainee-employment-v1','employment',coalesce(employment,'["Full Time","Part Time"]'::jsonb)),
   consent_version=null,enabled_since=clock_timestamp(),updated_at=clock_timestamp()
   where user_id=r.user_id;
  update career_applications set status='blocked',
   reason='지원 조건이 풀타임·파트타임으로 변경되었습니다. 이력서 화면에서 새 조건을 저장한 뒤 다시 준비해 주세요. 경력직은 자동지원 대상에서 제외됩니다.',
   version=version+1,updated_at=clock_timestamp()
   where user_id=r.user_id and origin='rule' and status in ('preparing','review','queued') and snapshot->>'flow'='uploaded-resume-v1';
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
