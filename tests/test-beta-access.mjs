import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {onRequest} from '../functions/api/career/[[path]].js';
import {onRequestGet} from '../functions/api/me/nickname.js';
import {navigation} from '../web/navigation.mjs';
const {JSDOM}=createRequire('/tmp/cpaping-career-qa/package.json')('jsdom');
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const env={CAREER_ENABLED:'true',CAREER_RESUME_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'fake',CAREER_ADMIN_USER_IDS:uid};
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
const pause=()=>new Promise(r=>setTimeout(r,20));

test('non-admin beta API calls reject before private reads or mutations, including spoofed roles',async t=>{
 let current=other,confirmed='yes',dbCalls=0;
 t.mock.method(globalThis,'fetch',async url=>{if(String(url).includes('/auth/'))return json({id:current,email_confirmed_at:confirmed,user_metadata:{role:'admin'},app_metadata:{role:'admin'}});dbCalls++;return json([]);});
 for(const [path,method] of [['resume-state','GET'],['resume-draft','PUT'],['resume-automation','PUT'],['resumes','POST'],['resume-applications/'+uid,'PUT'],['application-history','GET'],['application-history/'+uid,'DELETE'],['deliveries','GET'],['files/'+uid,'GET'],['applications','POST'],['jobs','POST']]){
  const request=new Request('https://cpaping.com/api/career/'+path,{method,headers:{Authorization:'Bearer test'}});
  assert.equal((await onRequest({env,request,params:{path:path.split('/')}})).status,403,path);
 }
 assert.equal(dbCalls,0);
 current=uid;confirmed=null;
 assert.equal((await onRequest({env,request:new Request('https://cpaping.com/api/career/resume-state',{headers:{Authorization:'Bearer test'}}),params:{path:['resume-state']}})).status,401);
});

test('admin access is server-configured, defaults closed, and returns only a boolean',async t=>{
 t.mock.method(globalThis,'fetch',async url=>String(url).includes('/auth/')?json({id:uid,email_confirmed_at:'yes'}):json([{nickname:'운영계정'}]));
 const request=new Request('https://cpaping.com/api/me/nickname',{headers:{Authorization:'Bearer test'}});
 const allowed=await onRequestGet({request,env});assert.deepEqual(await allowed.json(),{nickname:'운영계정',career_admin:true});assert.match(allowed.headers.get('Cache-Control'),/no-store/);
 assert.equal((await (await onRequestGet({request,env:{...env,CAREER_ADMIN_USER_IDS:''}})).json()).career_admin,false);
 const career=await onRequest({env,request,params:{path:['deliveries']}});assert.equal(career.status,200);
});

test('navigation keeps beta links disabled until verified admin and revokes them on logout',async()=>{
 const html=navigation(readFileSync('web/account.html','utf8').replace('</main>','<a href="/applications/?posting=42">지원하기</a></main>'),'/account/');
 const dom=new JSDOM(html,{url:'https://cpaping.com/account/',runScripts:'outside-only'}),w=dom.window;
 try{
  const links=[...w.document.querySelectorAll('[data-admin-href]')];assert.equal(links.length,5);
  for(const a of links){assert.equal(a.hasAttribute('href'),false);assert.equal(a.getAttribute('aria-disabled'),'true');if(!a.dataset.adminHref.includes('?'))assert.match(a.textContent,/beta/);}
  assert.match(w.document.querySelector('.site-tabs a[href="/board/"]').textContent,/게시판 beta/);
  let admin=false;w.fetch=async()=>({ok:true,json:async()=>({nickname:'회원',career_admin:admin})});
  w.localStorage.setItem('sb-test-auth-token',JSON.stringify({access_token:'fake'}));w.eval(readFileSync('web/navigation.js','utf8'));await pause();assert.ok(links.every(a=>!a.hasAttribute('href')));
  admin=true;w.dispatchEvent(new w.Event('pageshow'));await pause();assert.ok(links.every(a=>a.getAttribute('href')===a.dataset.adminHref&&!a.hasAttribute('aria-disabled')));
  w.localStorage.clear();w.dispatchEvent(new w.StorageEvent('storage'));await pause();assert.ok(links.every(a=>!a.hasAttribute('href')));
 }finally{w.close();}
});

test('direct preparation/history pages stay hidden for non-admin and failed checks; admin can open both',async()=>{
 for(const page of ['resume','applications'])for(const access of [false,true,'error']){
  const dom=new JSDOM(readFileSync('web/'+page+'.html','utf8'),{url:'https://cpaping.com/'+page+'/',runScripts:'outside-only'}),w=dom.window;
  try{
   const user={id:uid,email:'me@example.com',email_confirmed_at:'yes',user_metadata:{agreed_terms_at:'yes'}},session={access_token:'test'};
   w.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{nickname:'회원'}})})})})})};
   let calls=0;w.fetch=async()=>{calls++;if(access==='error')throw Error('offline');return {ok:true,json:async()=>({career_admin:access})};};
   w.eval(readFileSync('web/auth.js','utf8'));const result=await w.cpAuth.ensure('needs_profile');
   assert.equal(result.state,access===true?'complete':'restricted');assert.equal(w.document.querySelector('[data-career-admin-page]').hidden,access!==true);assert.equal(calls,1);
  }finally{w.close();}
 }
});
