import {setup} from './preparation-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {resumeRequest} from '../functions/_resume.js';
const require=createRequire('/tmp/cpaping-career-qa/package.json'),{JSDOM}=require('jsdom'),{PGlite}=require('@electric-sql/pglite');
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const pause=()=>new Promise(r=>setTimeout(r,40));
async function wizard(){const s=await setup();await s.start();return {...s,writes:s.calls,next:s.next};}
test('wizard validates the agreed order and only starts automation at final confirmation',async()=>{
 const s=await wizard();try{const {$,d}=s;const writes=()=>s.calls.filter(c=>c.url.endsWith('/resume-rule'));assert.deepEqual([...d.querySelectorAll('.resume-progress button')].map(b=>b.lastElementChild.textContent),['이력서','지원 조건','메일 작성','Gmail 연결','발송 방식','최종 확인']);assert.equal(d.querySelectorAll('[data-resume-step]:not([hidden])').length,1);s.next();assert.equal($('resume-form').dataset.step,'1');$('resume-file-id').value=uid;s.next();$('resume-full').checked=false;$('resume-part').checked=false;s.next();assert.equal($('resume-form').dataset.step,'2');$('resume-part').checked=true;s.next();s.next();assert.equal($('resume-form').dataset.step,'3');$('applicant-name').value='지원자';s.next();s.next();await $('resume-form').onsubmit({preventDefault(){}});assert.equal(writes().length,0);assert.equal($('resume-form').dataset.step,'6');await $('resume-form').onsubmit({preventDefault(){}});assert.equal(writes().length,0);$('resume-confirmed').checked=true;await $('resume-form').onsubmit({preventDefault(){}});assert.equal(writes().length,1);assert.equal(writes()[0].body.enabled,true);assert.deepEqual(writes()[0].body.filters,{employment:['Part Time']});}finally{s.close();}
});
test('missing automatic consent returns to its step and focuses the visible control',async()=>{
 const s=await wizard();try{const {$,d}=s;$('resume-file-id').value=uid;$('applicant-name').value='지원자';for(let i=0;i<4;i++)s.next();d.querySelector('[name=send-mode][value=auto]').click();s.next();$('resume-confirmed').checked=true;await $('resume-form').onsubmit({preventDefault(){}});assert.equal($('resume-form').dataset.step,'5');assert.equal(d.activeElement.id,'resume-consent');assert.equal(s.calls.filter(c=>c.url.endsWith('/resume-rule')).length,0);}finally{s.close();}
});
test('save API has no daily quota input requirement and ignores a legacy client cap',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(JSON.parse(options.body));return new Response('[{}]',{headers:{'Content-Type':'application/json'}});});
 const env={CAREER_RESUME_ONLY:'true',CAREER_RESUME_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'fake'};
 for(const legacy of [{},{daily_limit:1}]){const data={resume_file_id:other,applicant_name:'지원자',subject:'제목',body:'본문',filters:{employment:['Full Time']},mode:'review',enabled:false,file_confirmed:true,...legacy};
 const response=await resumeRequest(new Request('https://cpaping.com/api/career/resume-rule',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),env,{id:uid},'resume-rule');assert.equal(response.status,200);assert.equal(calls.at(-1).p_limit,null);assert.equal(calls.at(-1).p_user,uid);}
});
test('unlimited migration claims past 20 sends, preserves rule versions, deduplication and private RPC permissions',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table job_postings(id bigint primary key);insert into auth.users values('${uid}'),('${other}');insert into job_postings select generate_series(1,30);`);
 for(const file of ['014_career_workspace.sql','016_mail_delivery_history.sql','017_uploaded_resume.sql'])await db.exec(readFileSync('db/migrations/'+file,'utf8'));
 const file=(await db.query('select career_upload_resume($1,$2,$3,$4) as id',[uid,'resume.pdf','application/pdf','JVBERi0xLjQKZXhhbXBsZQ=='])).rows[0].id;
 await db.query("insert into career_mail_accounts(user_id,provider,email,token_encrypted) values($1,'google','qa@example.com','fake')",[uid]);
 await db.query("insert into career_rules(user_id,resume_file_id,enabled,mode,daily_limit,consent_version) values($1,$2,true,'auto',1,'resume-auto-v1')",[uid,file]);
 await db.query("insert into career_profiles(user_id) values($1);",[other]);await db.query("insert into career_rules(user_id,daily_limit) values($1,5)",[other]);
 const before=(await db.query('select * from career_rules where user_id=$1',[uid])).rows[0];
 await db.query("insert into career_applications(user_id,posting_id,canonical_posting_id,status,snapshot) select $1,i,i,case when i<=25 then 'sent' else 'queued' end,'{\"flow\":\"uploaded-resume-v1\"}'::jsonb from generate_series(1,27) i",[uid]);
 assert.equal((await db.query('select * from career_claim_resume_send()')).rows.length,0);
 await db.exec(readFileSync('db/migrations/021_unlimited_resume_sending.sql','utf8'));
 const after=(await db.query('select * from career_rules where user_id=$1',[uid])).rows[0];assert.equal(after.daily_limit,null);assert.equal(after.updated_at.toISOString(),before.updated_at.toISOString());assert.equal(after.enabled,true);assert.equal(after.consent_version,before.consent_version);
 assert.equal((await db.query('select daily_limit from career_rules where user_id=$1',[other])).rows[0].daily_limit,5);
 const first=(await db.query('select * from career_claim_resume_send()')).rows[0],second=(await db.query('select * from career_claim_resume_send()')).rows[0];assert.ok(first&&second);assert.notEqual(first.id,second.id);assert.equal(first.status,'sending');assert.equal((await db.query('select * from career_claim_resume_send()')).rows.length,0);
 await assert.rejects(()=>db.query("insert into career_applications(user_id,posting_id,canonical_posting_id) values($1,26,26)",[uid]),/unique/);
 const save=(owner,expected,consent='resume-auto-v1')=>db.query('select * from career_save_resume_rule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[owner,file,'지원자','제목','본문','{}','auto',true,1,consent,expected]);
 await assert.rejects(()=>save(other,null),/resume_conflict/);await assert.rejects(()=>save(uid,null),/resume_conflict/);await assert.rejects(()=>save(uid,before.updated_at,null),/resume_consent/);
 assert.equal((await save(uid,before.updated_at)).rows[0].daily_limit,null);
 assert.equal((await db.query("select has_function_privilege('anon','career_claim_resume_send()','EXECUTE') as allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('authenticated','career_save_resume_rule(uuid,uuid,text,text,text,jsonb,text,boolean,integer,text,timestamptz)','EXECUTE') as allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
