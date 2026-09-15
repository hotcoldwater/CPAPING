import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createRequire} from 'node:module';
import {buildAssetFiles} from '../web/asset-builder.mjs';import {versionAssets} from '../web/version-assets.mjs';import {navigation} from '../web/navigation.mjs';
const require=createRequire('/tmp/cpaping-career-qa/package.json'),{JSDOM}=require('jsdom'),pause=()=>new Promise(r=>setTimeout(r,50));
test('a changed script and its dependents get fresh URLs; static and live pages share those URLs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cpaping-cache-'));try{
 writeFileSync(join(dir,'auth.js'),'window.authVersion=1;');writeFileSync(join(dir,'navigation.js'),'load("/auth.js");');
 const first=buildAssetFiles(dir);assert.match(first['/navigation.js'],/^\/assets\/navigation\.[a-f0-9]{16}\.js$/);assert.ok(readFileSync(join(dir,first['/navigation.js']),'utf8').includes(first['/auth.js']));
 writeFileSync(join(dir,'auth.js'),'window.authVersion=2;');writeFileSync(join(dir,'navigation.js'),'load("/auth.js");');const second=buildAssetFiles(dir);assert.notEqual(first['/auth.js'],second['/auth.js']);assert.notEqual(first['/navigation.js'],second['/navigation.js']);
 const html=navigation('<head><script src="/auth.js"></script></head><header class="topbar"></header>','/',second);assert.ok(html.includes(second['/navigation.js']));assert.ok(html.includes(second['/auth.js']));assert.ok(!html.includes('src="/navigation.js"'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('new resume and history pages never request a cached pre-split script, and each loads only its own data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cpaping-split-'));try{
 writeFileSync(join(dir,'resume.js'),readFileSync('web/resume.js','utf8'));writeFileSync(join(dir,'applications.js'),readFileSync('web/applications.js','utf8'));const versions=buildAssetFiles(dir);
 const stale=new Map([['/resume.js',"document.getElementById('resume-firms').append('old'); document.getElementById('resume-applications').replaceChildren();"]]);
 for(const name of ['resume','applications']){
  const html=versionAssets(readFileSync('web/'+name+'.html','utf8'),versions);const dom=new JSDOM(html,{url:'https://cpaping.com/'+name+'/',runScripts:'outside-only'}),w=dom.window;
  try{w.cpAuth={ensure:async()=>({state:'complete'}),client:{auth:{getSession:async()=>({data:{session:{access_token:'fake'}}})},from:()=>({select:()=>({order:()=>({limit:async()=>({data:[{id:1,name:'예시법인'}]})})})})}};
   const methods=[];w.fetch=async(url,options)=>{methods.push(options.method);return {ok:true,json:async()=>url.endsWith('/state')?{mail:{email:'owner@example.com'}}:url.includes('application-history')?{items:[],has_more:false}:{files:[],applications:[],limit:100}};};
   for(const script of w.document.scripts){const path=new URL(script.src||'/',w.location).pathname;if(path.startsWith('/assets/')&&/\/(resume|applications)\./.test(path)){assert.ok(!stale.has(path));w.eval(readFileSync(join(dir,path),'utf8'));}}
   await pause();if(name==='resume'){assert.match(w.document.getElementById('mail-state').textContent,/owner@example.com/);assert.equal(typeof w.document.getElementById('disconnect').onclick,'function');}else{assert.equal(w.document.getElementById('mail-state'),null);assert.equal(w.document.querySelector('#resume-form'),null);assert.equal(w.document.querySelectorAll('.history-table').length,1);}assert.ok(!w.document.body.textContent.includes('Cannot read properties'));assert.ok(methods.every(x=>x==='GET'));
  }finally{w.close();}
 }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('failed page loads expose retry controls and do not submit default settings',async()=>{
 for(const name of ['resume','applications']){const dom=new JSDOM(readFileSync('web/'+name+'.html','utf8'),{url:'https://cpaping.com/'+name+'/',runScripts:'outside-only'}),w=dom.window;try{const writes=[];w.cpAuth={ensure:async()=>({state:'complete'}),client:{auth:{getSession:async()=>({data:{session:{access_token:'fake'}}})}}};w.fetch=async(url,opt)=>{writes.push(opt.method);return {ok:false,json:async()=>({error:'목록 조회 실패'})};};w.eval(readFileSync('web/'+name+'.js','utf8'));await pause();const d=w.document;if(name==='resume'){assert.equal(d.getElementById('resume-form').hidden,true);assert.equal(d.getElementById('save-resume-rule').disabled,true);assert.equal(d.getElementById('retry-resume').hidden,false);}else{assert.equal(d.getElementById('refresh').disabled,false);assert.match(d.getElementById('message').textContent,/실패/);}assert.ok(writes.every(x=>x==='GET'));}finally{w.close();}}
});
test('expired sessions refresh before showing the saved nickname',async()=>{
 const dom=new JSDOM(navigation('<head></head><header class="topbar"></header>'),{url:'https://cpaping.com/',runScripts:'outside-only'}),w=dom.window;
 try{w.localStorage.setItem('sb-test-auth-token',JSON.stringify({access_token:'expired',user:{id:'u'}}));let refreshed=0;const headers=[];
 w.cpAuth={client:{auth:{getSession:async()=>({data:{session:{access_token:'expired',user:{id:'u'}}}}),refreshSession:async()=>{refreshed++;return {data:{session:{access_token:'fresh',user:{id:'u'}}}};},onAuthStateChange:()=>{}}}};
 w.fetch=async(url,options)=>{headers.push(options.headers.Authorization);return options.headers.Authorization==='Bearer expired'?{ok:false,status:401}:{ok:true,status:200,json:async()=>({nickname:'실제닉네임'})};};
 w.eval(readFileSync('web/navigation.js','utf8'));await pause();assert.ok(refreshed>=1);assert.ok(headers.includes('Bearer fresh'));assert.equal(w.document.getElementById('account-nickname').textContent,'실제닉네임');
 }finally{w.close();}
});
