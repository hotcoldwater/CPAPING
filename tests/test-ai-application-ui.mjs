import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';
const require=createRequire('/tmp/cpaping-career-qa/package.json'),{JSDOM}=require('jsdom');
const pause=()=>new Promise(r=>setTimeout(r,50));
test('blocked email application allows editing filenames and sending; website never exposes send',async()=>{
 for(const method of ['email','website']){
 const w=new JSDOM(readFileSync('web/applications.html','utf8'),{url:'https://cpaping.com/applications/?review=11111111-1111-4111-8111-111111111111',runScripts:'outside-only'}).window;
 try{w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.cpAuth={ensure:async()=>({state:'complete'}),client:{auth:{getSession:async()=>({data:{session:{access_token:'fake'}}})}}};const calls=[];
 const item={id:'11111111-1111-4111-8111-111111111111',application_id:'11111111-1111-4111-8111-111111111111',company:'예시',status:'blocked',version:1,recipient:'hr@example.com',subject:'기존 제목',body:'본문',reason:'지정양식',snapshot:{analysis:{method,apply_url:'https://example.com/apply'},attachments:[{id:'22222222-2222-4222-8222-222222222222',name:'지원서.pdf'}]}};
 w.fetch=async(url,opt)=>{calls.push({url,body:opt.body?JSON.parse(opt.body):null});return {ok:true,json:async()=>({items:[item],has_more:false})};};w.eval(readFileSync('web/applications.js','utf8'));await pause();
 const target=w.document.getElementById('application-detail'),send=[...target.querySelectorAll('button')].find(b=>b.textContent==='검수 완료 · 보내기');
 if(method==='website'){assert.equal(send,undefined);assert.equal(target.querySelector('a.btn').href,'https://example.com/apply');continue;}
 assert.ok(send);const name=target.querySelector('.attachment-row input');name.value='직접수정.pdf';name.dispatchEvent(new w.Event('input'));target.querySelector('input[type=checkbox]').checked=true;await send.onclick();const sent=calls.find(c=>c.body?.action==='approve');assert.equal(sent.body.attachments[0].name,'직접수정.pdf');assert.equal(sent.body.version,1);
 }finally{w.close();}
 }
});
