import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';
import {onRequest as history} from '../functions/api/career/[[path]].js';import {onRequest as pixel} from '../functions/api/mail-open/[[path]].js';import {navigation} from '../web/navigation.mjs';
const require=createRequire('/tmp/cpaping-career-qa/package.json');const {PGlite}=require('@electric-sql/pglite'),{JSDOM}=require('jsdom');
const uid='11111111-1111-4111-8111-111111111111',env={CAREER_ENABLED:'true',CAREER_HISTORY_ENABLED:'true',CAREER_JOBS_ENABLED:'false',CAREER_APPLICATIONS_ENABLED:'false',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'fake'};
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
test('history is owner-scoped and excludes tracking identifiers; background work stays disabled',async(t)=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{calls.push(String(url));return String(url).includes('/auth/')?json({id:uid,email_confirmed_at:'yes'}):json([]);});
 const r=await history({request:new Request('https://cpaping.com/api/career/deliveries',{headers:{Authorization:'Bearer fake'}}),env,params:{path:['deliveries']}});assert.equal(r.status,200);assert.match(calls[1],new RegExp('user_id=eq.'+uid));assert.ok(!calls[1].includes('tracking_hash'));assert.match(r.headers.get('Cache-Control'),/no-store/);
 for(const path of ['jobs','applications','rules','templates'])assert.equal((await history({request:new Request('https://cpaping.com/api/career/'+path,{method:'POST',headers:{Authorization:'Bearer fake'}}),env,params:{path:[path]}})).status,503);
});
test('pixel records only a hash for GET and reveals no existence information',async(t)=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(JSON.parse(options.body));return json(null);});const token='a'.repeat(43);
 const req=method=>({request:new Request('https://cpaping.com/api/mail-open/'+token+'.gif',{method}),env,params:{path:[token+'.gif']}});
 const head=await pixel(req('HEAD'));assert.equal(head.status,200);assert.equal(calls.length,0);
 const get=await pixel(req('GET'));assert.equal(get.headers.get('Content-Type'),'image/gif');assert.equal(calls.length,1);assert.match(calls[0].p_hash,/^[a-f0-9]{64}$/);assert.deepEqual(Object.keys(calls[0]),['p_hash']);
 const bad=await pixel({...req('GET'),params:{path:['invalid.gif']}});assert.equal(calls.length,1);assert.deepEqual(new Uint8Array(await get.arrayBuffer()),new Uint8Array(await bad.arrayBuffer()));
});
test('delivery DB denies public reads, records first signal only and prevents duplicate sends',async()=>{
 const db=new PGlite();try{await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table career_applications(id uuid primary key);create table career_files(id uuid primary key);insert into auth.users values('${uid}');`);await db.exec(readFileSync('db/migrations/016_mail_delivery_history.sql','utf8'));
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_table_privilege($1,'public.career_mail_deliveries','SELECT') as ok`,[role])).rows[0].ok,false);
 assert.equal((await db.query("select has_function_privilege('anon','public.career_record_open(text)','EXECUTE') as ok")).rows[0].ok,false);
 const h='a'.repeat(64);await db.query("insert into career_mail_deliveries(user_id,company,recipient,subject,body,mode,status,tracking_hash,test_key) values($1,'test','x@example.com','test','body','test','sent',$2,'one-test')",[uid,h]);
 await db.query('select career_record_open($1)',[h]);const first=(await db.query('select first_open_at from career_mail_deliveries')).rows[0].first_open_at;assert.ok(first);
 await db.query('select career_record_open($1)',[h]);assert.deepEqual((await db.query('select first_open_at from career_mail_deliveries')).rows[0].first_open_at,first);
 await assert.rejects(()=>db.query("insert into career_mail_deliveries(user_id,company,recipient,subject,body,mode,test_key) values($1,'test','x@example.com','test','body','test','one-test')",[uid]),/unique/);
 await db.query('delete from auth.users where id=$1',[uid]);assert.equal((await db.query('select count(*)::int as n from career_mail_deliveries')).rows[0].n,0);
 }finally{await db.close();}
});
test('navigation has requested order, logged-in menu choices and keyboard close',()=>{
 const html=navigation('<html><head></head><body><header class="topbar"><a>old</a></header></body></html>','/essay/');const dom=new JSDOM(html,{url:'https://cpaping.com/essay/',runScripts:'outside-only'});const d=dom.window.document;
 assert.deepEqual([...d.querySelectorAll('nav a')].map(a=>a.textContent),['공고','법인','자소서','게시판']);assert.equal(d.querySelector('[aria-current]').getAttribute('href'),'/essay/');
 dom.window.localStorage.setItem('sb-test-auth-token',JSON.stringify({access_token:'fake'}));dom.window.eval(readFileSync('web/navigation.js','utf8'));const menu=d.getElementById('account-menu');assert.equal(menu.hidden,false);assert.deepEqual([...menu.querySelectorAll('a')].map(a=>a.textContent),['내 지원현황','내 정보']);menu.open=true;d.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(menu.open,false);dom.window.close();
});
test('history renders email as text, exposes no tracking image and shows uncertainty',async()=>{
 const dom=new JSDOM(readFileSync('web/applications.html','utf8'),{url:'https://cpaping.com/applications/',runScripts:'outside-only'});dom.window.cpAuth={ensure:async()=>({state:'complete'}),client:{auth:{getSession:async()=>({data:{session:{access_token:'fake'}}})}}};
 dom.window.fetch=async url=>({ok:true,json:async()=>String(url).includes('deliveries')?{items:[{id:uid,company:'테스트 법인',recipient:'x@example.com',subject:'<img onerror=alert(1)>',body:'<script>bad()</script>',status:'sent',mode:'auto',first_open_at:'2026-09-13T00:00:00Z'}],has_more:false}:{mail:{email:'self@example.com'}}});
 dom.window.eval(readFileSync('web/applications.js','utf8'));await new Promise(r=>setTimeout(r,35));const d=dom.window.document;assert.equal(d.querySelectorAll('#deliveries img,#deliveries script').length,0);assert.match(d.getElementById('deliveries').textContent,/읽음 추정/);assert.match(d.getElementById('deliveries').textContent,/<script>bad/);dom.window.close();
});
