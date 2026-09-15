import {setup,saved} from './preparation-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import {resumeUpload,mailTemplate,resumeFilters} from '../functions/_resume.js';import {onRequest} from '../functions/api/career/[[path]].js';
const require=createRequire('/tmp/cpaping-career-qa/package.json'),{PGlite}=require('@electric-sql/pglite'),{JSDOM}=require('jsdom');
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const env={CAREER_ENABLED:'true',CAREER_RESUME_ONLY:'true',CAREER_RESUME_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'fake'};
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
const args=(path,method='GET',data)=>({env,params:{path:path.split('/')},request:new Request('https://cpaping.com/api/career/'+path,{method,headers:{Authorization:'Bearer fake','Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})})});
test('upload rejects renamed executables, traversal, excess size and malformed base64',()=>{
 const good={name:'홍길동_이력서.pdf',data_base64:Buffer.from('%PDF-1.4\nexample').toString('base64')};assert.equal(resumeUpload(good).mime,'application/pdf');
 for(const b of [{...good,name:'../a.pdf'},{...good,name:'a.docx'},{...good,data_base64:'AAAA'},{...good,data_base64:'A'.repeat(4000004)},{...good,data_base64:'%PDF1234'},{...good,name:'bad\n.pdf'}])assert.throws(()=>resumeUpload(b));
 assert.throws(()=>mailTemplate('제목\nBcc: x@example.com',200,true));assert.throws(()=>mailTemplate('{비밀번호}',200));assert.equal(mailTemplate('{법인} - {이름}',200,true),'{법인} - {이름}');
});
test('resume-only mode blocks essay/AI routes and state reveals only sender metadata',async(t)=>{
 const calls=[];t.mock.method(globalThis,'fetch',async url=>{calls.push(String(url));return String(url).includes('/auth/')?json({id:uid,email_confirmed_at:'yes'}):json([]);});
 for(const p of ['profile','jobs','rules','templates','applications'])assert.equal((await onRequest(args(p,'POST',{}))).status,503);
 const r=await onRequest(args('state'));assert.equal((await r.json()).resume_only,true);assert.ok(calls.every(x=>!x.includes('career_profiles')&&!x.includes('career_jobs')));
});
test('upload always uses authenticated owner, no user supplied recipient or owner',async(t)=>{
 let saved;t.mock.method(globalThis,'fetch',async(url,opt)=>String(url).includes('/auth/')?json({id:uid,email_confirmed_at:'yes'}):(saved=JSON.parse(opt.body),json('file-id')));
 const r=await onRequest(args('resumes','POST',{user_id:other,name:'resume.pdf',data_base64:Buffer.from('%PDF-1.4\nexample').toString('base64')}));assert.equal(r.status,201);assert.equal(saved.p_user,uid);assert.deepEqual(Object.keys(saved).sort(),['p_data','p_mime','p_name','p_user']);
});
test('resume database enforces ownership, stale settings and pause invalidation',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table job_postings(id bigint primary key);insert into auth.users values('${uid}'),('${other}');insert into job_postings values(1);`);
 for(const file of ['014_career_workspace.sql','016_mail_delivery_history.sql','017_uploaded_resume.sql'])await db.exec(readFileSync('db/migrations/'+file,'utf8'));
 const upload=async user=>(await db.query('select career_upload_resume($1,$2,$3,$4) as id',[user,'resume.pdf','application/pdf','JVBERi0xLjQKZXhhbXBsZQ=='])).rows[0].id;
 const file=await upload(uid),foreign=await upload(other);
 const save=(id,expected=null,enabled=false,consent=null)=>db.query('select * from career_save_resume_rule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[uid,id,'지원자','제목','본문',JSON.stringify({all_firms:true}),'auto',enabled,5,consent,expected]);
 await assert.rejects(()=>save(foreign),/resume_missing/);await assert.rejects(()=>save(file,null,true,'resume-auto-v1'),/resume_consent/);
 await db.query("insert into career_mail_accounts(user_id,provider,email,token_encrypted) values($1,'google','x@example.com','fake')",[uid]);
 const rule=(await save(file,null,true,'resume-auto-v1')).rows[0];await assert.rejects(()=>save(file,null),/resume_conflict/);
 await db.query("insert into career_applications(user_id,posting_id,canonical_posting_id,status,snapshot,document_id) values($1,1,1,'queued',$2,$3)",[uid,JSON.stringify({flow:'uploaded-resume-v1'}),file]);
 await upload(uid);assert.equal((await db.query('select enabled from career_rules where user_id=$1',[uid])).rows[0].enabled,false);
 const app=(await db.query('select status,version from career_applications where user_id=$1',[uid])).rows[0];assert.equal(app.status,'review');assert.equal(app.version,2);
 await assert.rejects(()=>save(file,rule.updated_at),/resume_conflict/);await assert.rejects(()=>db.query('select career_delete_resume($1,$2)',[uid,file]),/resume_in_use/);
 assert.equal((await db.query("select has_function_privilege('anon','career_upload_resume(uuid,text,text,text)','EXECUTE') as ok")).rows[0].ok,false);
 assert.equal((await db.query('select * from career_claim_resume_send()')).rows.length,0);
 }finally{await db.close();}
});
test('review cannot replace recipient with an address outside source',async(t)=>{
 const file=other,app={id:uid,user_id:uid,status:'review',version:1,document_id:file,snapshot:{flow:'uploaded-resume-v1',allowed_recipients:['hr@example.com']}};
 t.mock.method(globalThis,'fetch',async url=>String(url).includes('/auth/')?json({id:uid,email_confirmed_at:'yes'}):json([app]));
 const r=await onRequest(args('resume-applications/'+uid,'PUT',{version:1,action:'approve',reviewed:true,recipient:'attacker@example.com'}));assert.equal(r.status,400);
});
test('resume UI safely renders file names and defaults to review with automation off',async()=>{
 const dom=new JSDOM(readFileSync('web/resume.html','utf8'),{url:'https://cpaping.com/applications/',runScripts:'outside-only'}),w=dom.window;
 w.cpAuth={ensure:async()=>({state:'complete'}),client:{auth:{getSession:async()=>({data:{session:{access_token:'fake'}}})},from:()=>({select:()=>({order:()=>({limit:async()=>({data:[{id:1,name:'테스트 법인'}]})})})})}};
 w.fetch=async()=>({ok:true,json:async()=>({files:[{id:uid,name:'<img src=x onerror=bad()>.pdf'}],rule:null,applications:[],limit:100})});
 w.eval(readFileSync('web/resume.js','utf8'));await new Promise(r=>setTimeout(r,40));assert.equal(w.document.querySelectorAll('#resume-files img').length,0);assert.equal(w.document.getElementById('automation-enabled').checked,false);assert.equal(w.document.getElementById('resume-mode').value,'review');assert.equal(w.document.getElementById('resume-consent').checked,false);dom.window.close();
});

test('resume filters accept only full/part employment and stamp the new server scope',()=>{
 assert.deepEqual(resumeFilters({employment:['Part Time','Full Time']}),{scope:'trainee-employment-v1',employment:['Full Time','Part Time']});
 assert.deepEqual(resumeFilters({employment:['Part Time']}).employment,['Part Time']);
 for(const value of [null,[],{}, {employment:[]},{employment:['Career']},{employment:['Full Time'],all_firms:true},{employment:['Full Time'],regions:[]}])assert.throws(()=>resumeFilters(value));
});
test('preparation only saves selected employment and needs no firm data',async()=>{
 const s=await setup({rule:saved});try{await s.start();const {$,d}=s;for(const id of ['resume-firms','resume-regions','resume-years'])assert.equal($(id),null);$('resume-full').checked=false;$('resume-part').checked=true;for(let i=0;i<5;i++)s.next();$('resume-confirmed').checked=true;await $('resume-form').onsubmit({preventDefault(){}});assert.deepEqual(s.calls.find(c=>c.url.endsWith('/resume-rule')).body.filters,{employment:['Part Time']});}finally{s.close();}
});
test('filter migration pauses legacy rules, drops restrictions and invalidates old automatic queues',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table job_postings(id bigint primary key);insert into auth.users values('${uid}'),('${other}');insert into job_postings values(1);`);
 for(const file of ['014_career_workspace.sql','016_mail_delivery_history.sql','017_uploaded_resume.sql'])await db.exec(readFileSync('db/migrations/'+file,'utf8'));
 const file=(await db.query('select career_upload_resume($1,$2,$3,$4) as id',[uid,'resume.pdf','application/pdf','JVBERi0xLjQKZXhhbXBsZQ=='])).rows[0].id;
 await db.query("insert into career_rules(user_id,resume_file_id,enabled,mode,filters,consent_version) values($1,$2,true,'auto',$3,'resume-auto-v1')",[uid,file,JSON.stringify({all_firms:false,firm_ids:[12],regions:['서울'],employment:['Part Time'],revenue_min:100})]);
 await db.query("insert into career_profiles(user_id) values($1)",[other]);
 await db.query("insert into career_rules(user_id,enabled,filters) values($1,false,$2)",[other,JSON.stringify({all_firms:false,firm_ids:[12]})]);
 await db.query("insert into career_applications(user_id,posting_id,canonical_posting_id,status,origin,snapshot,document_id) values($1,1,1,'queued','rule',$2,$3)",[uid,JSON.stringify({flow:'uploaded-resume-v1'}),file]);
 const sql=readFileSync('db/migrations/020_simple_resume_filters.sql','utf8');await db.exec(sql);
 let rule=(await db.query('select * from career_rules where user_id=$1',[uid])).rows[0];assert.equal(rule.enabled,false);assert.equal(rule.consent_version,null);assert.deepEqual(rule.filters,{scope:'trainee-employment-v1',employment:['Part Time']});
 const app=(await db.query('select * from career_applications')).rows[0];assert.equal(app.status,'blocked');assert.ok(app.version>1);
 assert.deepEqual((await db.query('select filters from career_rules where user_id=$1',[other])).rows[0].filters,{all_firms:false,firm_ids:[12]});
 await db.exec(sql);assert.equal((await db.query('select updated_at from career_rules where user_id=$1',[uid])).rows[0].updated_at.toISOString(),rule.updated_at.toISOString());
 // A previously unrestricted employment selection becomes both, still paused.
 await db.query("update career_rules set filters='{}',enabled=true where user_id=$1",[uid]);await db.exec(sql);
 rule=(await db.query('select * from career_rules where user_id=$1',[uid])).rows[0];assert.equal(rule.enabled,false);assert.deepEqual(rule.filters.employment,['Full Time','Part Time']);
 }finally{await db.close();}
});
