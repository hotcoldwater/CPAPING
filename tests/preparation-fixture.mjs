import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire('/tmp/cpaping-career-qa/package.json'),{JSDOM}=require('jsdom');
export const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
export const pause=()=>new Promise(r=>setTimeout(r,50));
export const saved={resume_file_id:uid,applicant_name:'지원자',mail_subject_template:'[회계법인] {이름}',mail_body_template:'{공고}',enabled:true,mode:'review',filters:{employment:['Full Time']},updated_at:'2026-09-14T10:00:00Z'};
export async function setup({rule=null,draft=null,failState=false,failSave=false,steps=true}={}){
 const dom=new JSDOM(readFileSync('web/resume.html','utf8'),{url:'https://cpaping.com/resume/',runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[];
 const stored={files:[{id:uid,name:'테스트_이력서.pdf',created_at:'2026-09-14T10:00:00Z'}],rule:structuredClone(rule),draft:structuredClone(draft),applications:[],limit:100};
 w.cpAuth={ensure:async()=>({state:'complete'}),client:{auth:{getSession:async()=>({data:{session:{access_token:'fake'}}})}}};
 w.fetch=async(url,options)=>{const b=options.body?JSON.parse(options.body):null;calls.push({url,method:options.method,body:b});let data;
 if(url.endsWith('/resume-state')){if(failState)return {ok:false,json:async()=>({error:'조회 실패'})};data=structuredClone(stored);}
 else if(url.endsWith('/state'))data={mail:{email:'qa@example.com',reply_read_enabled:true}};
 else if(url.endsWith('/resume-rule')){if(failSave)return {ok:false,json:async()=>({error:'저장에 실패했습니다.'})};stored.rule={...b,mail_subject_template:b.subject,mail_body_template:b.body,updated_at:'2026-09-15T01:00:00Z'};stored.draft=null;data=stored.rule;}
 else if(url.endsWith('/resume-draft')){if(options.method==='DELETE'){stored.draft=null;data={ok:true};}else{stored.draft={data:b.data,version:b.version+1,base_rule_updated_at:b.base_rule_updated_at};data=structuredClone(stored.draft);}}
 else if(url.endsWith('/resumes')){stored.files.unshift({id:other,name:b.name});data={id:other,name:b.name};}
 else data={};return {ok:true,json:async()=>data};};
 for(const file of ['resume-preview.js',...(steps?['resume-steps.js']:[]),'resume.js'])w.eval(readFileSync('web/'+file,'utf8'));await pause();
 const $=id=>d.getElementById(id);return {w,d,calls,stored,$,next:()=>$('resume-next').click(),start:async()=>{await $(rule?'edit-preparation':draft?'continue-preparation':'start-preparation').onclick();},close:()=>w.close()};
}
