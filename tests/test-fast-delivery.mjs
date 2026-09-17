import test from 'node:test';import assert from 'node:assert/strict';
import worker,{checkWork,wakeWorkflow} from '../worker/src/index.js';
import {wakeDelivery} from '../functions/_wake.js';import {onRequest} from '../functions/api/work-pending.js';
const env={GITHUB_TOKEN:'github-test',GITHUB_REPO:'owner/repo',GITHUB_REF:'main',GITHUB_WORKFLOW:'crawl.yml',CAREER_DISPATCH_SECRET:'shared-test',CAREER_PENDING_URL:'https://cpaping.test/api/work-pending',CAREER_WAKE_URL:'https://cron.test/wake',CAREER_RESUME_ENABLED:'true',SUPABASE_URL:'https://db.test',SUPABASE_SECRET_KEY:'db-secret'};
const json=x=>Response.json(x);
test('public requests cannot dispatch work or inspect queue health',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(...args)=>{calls.push(args);throw new Error('unexpected request');});
 for(const method of ['GET','POST']){const req=new Request('https://cron.test/wake',{method});assert.ok((await worker.fetch(req,env)).status>=400);assert.ok((await onRequest({request:req,env})).status>=400);}
 assert.equal(calls.length,0);
});
test('approved wake targets only fixed delivery workflow and suppresses an active sender',async t=>{
 const calls=[];let running=false;t.mock.method(globalThis,'fetch',async(url,opt)=>{calls.push({url:String(url),...opt});return String(url).includes('/runs?')?json({workflow_runs:running?[{status:'in_progress'}]:[]}):new Response(null,{status:204});});
 const request=()=>new Request('https://cron.test/wake',{method:'POST',headers:{Authorization:'Bearer shared-test'}});
 assert.equal((await worker.fetch(request(),env)).status,200);assert.equal(calls.filter(c=>c.method==='POST').length,1);assert.match(calls.find(c=>c.method==='POST').url,/delivery.yml\/dispatches$/);
 running=true;assert.equal(await wakeWorkflow(env,'delivery'),false);assert.equal(calls.filter(c=>c.method==='POST').length,1);
});
test('minute recovery starts pending work even if crawl dispatch is rejected',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,opt)=>{url=String(url);calls.push(url);if(url===env.CAREER_PENDING_URL)return json({delivery:true,analysis:true,prepare:false});if(url.includes('crawl.yml/dispatches'))return new Response('denied',{status:403});if(url.includes('/runs?'))return json({workflow_runs:[]});return new Response(null,{status:204});});
 await assert.rejects(()=>worker.scheduled({scheduledTime:Date.parse('2026-09-17T11:31:00Z')},env,{waitUntil(){}}));
 assert.ok(calls.some(u=>u.includes('delivery.yml/dispatches')));assert.ok(calls.some(u=>u.includes('application-analysis.yml/dispatches')));assert.ok(!calls.some(u=>u.includes('resume.yml/dispatches')));
});
test('idle queue does not create unnecessary career jobs',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url)=>{calls.push(url);return json({delivery:false,prepare:false,analysis:false});});await checkWork(env);assert.equal(calls.length,1);
});
test('Pages wake failures never invalidate a persisted approval',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('offline');});assert.equal(await wakeDelivery(env),false);assert.equal(await wakeDelivery({}),false);
});
test('pending endpoint returns only the aggregate RPC and does not trust a user-supplied query',async t=>{
 let url;t.mock.method(globalThis,'fetch',async(u)=>{url=String(u);return json({delivery:true,prepare:false,analysis:false,overdue_count:0});});
 const response=await onRequest({request:new Request('https://cpaping.test/api/work-pending',{method:'POST',headers:{Authorization:'Bearer shared-test'}}),env});assert.equal(response.status,200);assert.match(url,/rpc\/career_work_pending$/);assert.equal((await response.json()).delivery,true);
});
