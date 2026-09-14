import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire('/tmp/cpaping-career-qa/package.json'),{JSDOM}=require('jsdom');
const pause=()=>new Promise(r=>setTimeout(r,35)),uid='11111111-1111-4111-8111-111111111111';
async function setup({failState=false,failSave=false,rule=null}={}){
 const dom=new JSDOM(readFileSync('web/resume.html','utf8'),{url:'https://cpaping.com/resume/',runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[];
 const stored={files:[{id:uid,name:'테스트_이력서.pdf',created_at:'2026-09-14T10:00:00Z'}],rule,applications:[],limit:100};
 w.cpAuth={ensure:async()=>({state:'complete'}),client:{auth:{getSession:async()=>({data:{session:{access_token:'fake'}}})}}};
 w.fetch=async(url,options)=>{const b=options.body?JSON.parse(options.body):null;calls.push({url,method:options.method,body:b});let data;
 if(url.endsWith('/resume-state')){if(failState)return {ok:false,json:async()=>({error:'목록 조회 실패'})};data=structuredClone(stored);}
 else if(url.endsWith('/state'))data={mail:{email:'qa@example.com'}};
 else if(url.endsWith('/resume-rule')){if(failSave)return {ok:false,json:async()=>({error:'저장에 실패했습니다. 다시 시도해 주세요.'})};stored.rule={...b,mail_subject_template:b.subject,mail_body_template:b.body,updated_at:'2026-09-15T01:00:00Z'};data=stored.rule;}
 else if(url.endsWith('/resumes')){stored.files.unshift({id:'new-file',name:b.name});if(stored.rule)stored.rule={...stored.rule,enabled:false,updated_at:'2026-09-15T02:00:00Z'};data={id:'new-file'};}
 else data={};return {ok:true,json:async()=>data};};
 w.eval(readFileSync('web/resume-preview.js','utf8'));w.eval(readFileSync('web/resume.js','utf8'));await pause();
 return {w,d,calls,stored,close:()=>w.close()};
}
const saved={resume_file_id:uid,applicant_name:'저장된 이름',mail_subject_template:'[회계법인] {이름}',mail_body_template:'{공고}',enabled:true,mode:'review',daily_limit:5,filters:{employment:['Full Time']},updated_at:'2026-09-14T10:00:00Z'};
test('real saved summary stays separate from a draft; mode radios and consent drive the save payload',async()=>{
 const s=await setup({rule:saved});try{const {d,w,calls}=s;assert.match(d.getElementById('resume-rule-state').textContent,/켜짐/);assert.match(d.getElementById('summary-mail').textContent,/qa@example.com/);assert.match(d.getElementById('summary-file').textContent,/테스트/);
 d.querySelector('[name=send-mode][value=auto]').click();assert.equal(d.getElementById('resume-mode').value,'auto');assert.equal(d.getElementById('auto-consent-panel').hidden,false);assert.equal(d.getElementById('resume-consent').checked,false);assert.match(d.getElementById('summary-mode').textContent,/수동발송/);
 await d.getElementById('resume-form').onsubmit({preventDefault(){}});assert.ok(!calls.some(c=>c.method==='PUT'));assert.match(d.getElementById('save-feedback').textContent,/동의/);
 d.getElementById('resume-consent').checked=true;d.getElementById('resume-confirmed').checked=true;
 await d.getElementById('resume-form').onsubmit({preventDefault(){}});const call=calls.find(c=>c.method==='PUT');assert.equal(call.body.mode,'auto');assert.equal(call.body.auto_consent,true);assert.deepEqual(call.body.filters,{employment:['Full Time']});assert.match(d.getElementById('summary-mode').textContent,/자동발송/);assert.equal(d.getElementById('resume-consent').checked,false);
 d.getElementById('resume-enabled').click();assert.match(d.getElementById('resume-rule-state').textContent,/켜짐/);assert.match(d.getElementById('save-feedback').textContent,/아직 저장되지/);assert.ok(calls.every(c=>!c.url.includes('resume-applications')));
 }finally{s.close();}
});
test('tags insert at the active cursor, preview all placeholders safely, and file changes clear confirmation',async()=>{
 const s=await setup({rule:saved});try{const {d,w}=s;const title=d.getElementById('resume-subject');title.focus();title.value='지원 ';title.setSelectionRange(3,3);d.querySelector('[data-token="{공고}"]').click();assert.equal(title.value,'지원 {공고}');assert.equal(d.getElementById('preview-subject').textContent,'지원 신입 회계사 채용');
 d.getElementById('applicant-name').value='<img src=x>';title.value='[회계법인] {이름} {공고}';title.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(d.querySelectorAll('#preview-subject img').length,0);assert.match(d.getElementById('preview-subject').textContent,/<img src=x>/);
 d.getElementById('resume-confirmed').checked=true;d.getElementById('resume-selected').value='';d.getElementById('resume-selected').dispatchEvent(new w.Event('change'));assert.equal(d.getElementById('resume-confirmed').checked,false);assert.equal(d.getElementById('download-current').disabled,true);
 }finally{s.close();}
});
test('upload retains draft text, selects new file and requires explicitly enabling and reconfirming',async()=>{
 const s=await setup({rule:saved});try{const {d,w}=s;d.getElementById('resume-subject').value='저장하지 않은 새 제목';d.getElementById('resume-subject').dispatchEvent(new w.Event('input',{bubbles:true}));const file=new w.File(['%PDF-test'],'new.pdf');const drop=new w.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{files:[file],types:['Files']}});d.getElementById('resume-drop').dispatchEvent(drop);
 assert.equal(d.getElementById('upload-resume').disabled,false);d.getElementById('upload-resume').click();await pause();assert.equal(d.getElementById('resume-subject').value,'저장하지 않은 새 제목');assert.equal(d.getElementById('resume-selected').value,'new-file');assert.equal(d.getElementById('resume-enabled').checked,false);assert.equal(d.getElementById('resume-confirmed').checked,false);assert.equal(d.getElementById('current-file-name').textContent,'new.pdf');assert.equal(d.getElementById('preview-file').textContent,'new.pdf');assert.match(d.getElementById('resume-rule-state').textContent,/꺼짐/);
 }finally{s.close();}
});
test('loading failure keeps defaults unsavable while Gmail works; save failure preserves edits',async()=>{
 const failed=await setup({failState:true});try{assert.equal(failed.d.getElementById('resume-editor').disabled,true);assert.equal(failed.d.getElementById('save-resume-rule').disabled,true);assert.equal(failed.d.getElementById('retry-resume').hidden,false);assert.match(failed.d.getElementById('mail-state').textContent,/qa@example.com/);}finally{failed.close();}
 const s=await setup({failSave:true,rule:saved});try{s.d.getElementById('resume-subject').value='보존할 수정';await s.d.getElementById('resume-form').onsubmit({preventDefault(){}});assert.equal(s.d.getElementById('resume-subject').value,'보존할 수정');assert.equal(s.d.getElementById('resume-editor').disabled,false);assert.match(s.d.getElementById('save-feedback').textContent,/실패/);}finally{s.close();}
});
