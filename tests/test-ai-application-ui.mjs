import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';
const require=createRequire('/tmp/cpaping-career-qa/package.json'),{JSDOM}=require('jsdom');
const pause=()=>new Promise(r=>setTimeout(r,40)),id='11111111-1111-4111-8111-111111111111',file='22222222-2222-4222-8222-222222222222';
async function fixture(patch={},query='?review='+id){
 const w=new JSDOM(readFileSync('web/applications.html','utf8'),{url:'https://cpaping.com/applications/'+query,runScripts:'outside-only',pretendToBeVisual:true}).window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.cpAuth={ensure:async()=>({state:'complete'}),client:{auth:{getSession:async()=>({data:{session:{access_token:'fake'}}})}}};const calls=[];
 const item={id,application_id:id,company:'예시법인',title:'신입 회계사',region:'서울',posted_at:'2026-09-16',status:'review',version:1,recipient:'hr@example.com',subject:'예시법인 지원자',body:'지원자입니다.',snapshot:{analysis:{method:'email'},attachments:[{id:file,name:'지원서.pdf'}]},...patch};
 w.fetch=async(url,opt)=>{const body=opt.body?JSON.parse(opt.body):null;calls.push({url,body});if(String(url).endsWith('resume-attachments'))return {ok:true,json:async()=>({id:file})};if(body?.action==='approve'){item.status='queued';item.version++;}return {ok:true,json:async()=>String(url).endsWith('resume-applications')?item:{items:[item],has_more:false}};};
 w.setInterval=fn=>{w.analysisPoll=fn;return 1;};w.eval(readFileSync('web/applications.js','utf8'));await pause();return {w,calls,item,target:w.document.getElementById('application-detail')};
}
test('review keeps attachments, supports delete/add, sends explicitly and waits for actual completion',async()=>{
 const {w,calls,target}=await fixture();try{
 assert.equal(target.querySelector('.attachment-row input').value,'지원서.pdf');const name=target.querySelector('.attachment-row input');name.value='직접수정.pdf';name.dispatchEvent(new w.Event('input'));const send=[...target.querySelectorAll('button')].find(b=>b.textContent==='발송');await send.onclick();
 const sent=calls.find(c=>c.body?.action==='approve');assert.equal(sent.body.attachments[0].name,'직접수정.pdf');assert.equal(sent.body.version,1);assert.match(target.textContent,/발송을 기다리고/);assert.doesNotMatch(w.document.querySelector('#deliveries').textContent,/지원완료/);
 }finally{w.close();}
});
test('needs confirmation always starts with no attachments and allows upload before send',async()=>{
 const {w,calls,target}=await fixture({status:'blocked',reason:'지정양식'});try{
 assert.equal(target.querySelectorAll('.attachment-row').length,0);assert.match(target.textContent,/지정양식/);const send=[...target.querySelectorAll('button')].find(b=>b.textContent==='발송');await send.onclick();assert.equal(calls.some(c=>c.body?.action==='approve'),false);
 const upload=target.querySelector('input[type=file]');Object.defineProperty(upload,'files',{value:[new w.File(['%PDF-1.7 test'],'별도양식.pdf',{type:'application/pdf'})]});await upload.onchange();assert.equal(target.querySelector('.attachment-row input').value,'별도양식.pdf');await send.onclick();assert.equal(calls.find(c=>c.body?.action==='approve').body.attachments[0].name,'별도양식.pdf');
 }finally{w.close();}
});
test('website opens external site and records manual completion date without sending mail',async()=>{
 const {w,calls,target}=await fixture({status:'blocked',snapshot:{analysis:{method:'website',apply_url:'https://example.com/apply'}}});try{
 assert.equal(target.querySelector('.send-application'),null);assert.equal(target.querySelector('a.btn').href,'https://example.com/apply');await [...target.querySelectorAll('button')].find(b=>b.textContent==='지원 상태·지원일 입력').onclick();target.querySelector('select').value='sent';const save=[...target.querySelectorAll('button')].find(b=>b.textContent==='저장');await save.onclick();assert.equal(calls.some(c=>c.url.endsWith('/status')),false);target.querySelector('input[type=date]').value='2026-09-15';await save.onclick();const result=calls.find(c=>c.url.endsWith('/status'));assert.deepEqual(result.body,{version:1,status:'sent',applied_on:'2026-09-15'});assert.equal(calls.some(c=>c.body?.action==='approve'),false);
 }finally{w.close();}
});
test('six readable columns, read badges, manual final pass and rejection; mail outcomes never auto-display',async()=>{
 const {w,calls,target}=await fixture({status:'sent',sent_at:'2026-09-17T01:00:00Z',first_open_at:'2026-09-17T02:00:00Z',outcome:'passed',outcome_source:'mail'},'');try{
 const d=w.document;assert.deepEqual([...d.querySelectorAll('th')].slice(0,6).map(x=>x.textContent),['법인/공고','지역','공고일','지원일','읽음여부','상태']);assert.equal(d.querySelector('.history-badge.read').textContent,'읽음');assert.equal(d.querySelector('.status-control').textContent,'지원완료');await d.querySelector('.status-control').onclick();assert.deepEqual([...target.querySelectorAll('option')].map(x=>x.textContent),['검수필요','확인필요','지원완료','서류합격','최종합격','불합격']);target.querySelector('select').value='final_passed';await [...target.querySelectorAll('button')].find(b=>b.textContent==='저장').onclick();assert.equal(calls.find(c=>c.url.endsWith('/status')).body.status,'final_passed');assert.equal(calls.some(c=>c.body?.action==='approve'),false);
 }finally{w.close();}
});
test('direct posting application opens personalized editor and never approves automatically',async()=>{
 const {w,calls,target}=await fixture({},'?posting=42');try{assert.equal(calls.find(c=>c.url.endsWith('resume-applications')).body.posting_id,'42');assert.equal(target.querySelectorAll('.attachment-row').length,1);assert.equal([...target.querySelectorAll('input')].some(n=>n.value==='예시법인 지원자'),true);assert.equal(calls.some(c=>c.body?.action==='approve'),false);}finally{w.close();}
});
test('pending analysis has a distinct label, no send button, and refreshes into review on completion',async()=>{
 const {w,calls,target,item}=await fixture({status:'preparing',display_status:'analyzing',reason:null});try{
 assert.equal(w.document.querySelector('.status-control').textContent,'AI 분석 중');assert.equal(w.document.querySelector('.status-control').disabled,true);assert.match(target.textContent,/AI가 공고의 지원 요건을 분석/);assert.equal(target.querySelector('.send-application'),null);assert.equal(calls.some(c=>c.body?.action==='approve'),false);
 w.fetch=async()=>({ok:true,json:async()=>({items:[{...item,status:'review',display_status:'review',version:2}],has_more:false})});await w.analysisPoll();assert.ok(target.querySelector('.send-application'));assert.equal(target.querySelector('.attachment-row input').value,'지원서.pdf');
 }finally{w.close();}
});
