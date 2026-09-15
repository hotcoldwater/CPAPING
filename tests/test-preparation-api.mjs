import test from 'node:test';import assert from 'node:assert/strict';import {onRequest} from '../functions/api/career/[[path]].js';import {seal} from '../functions/_career.js';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const env={CAREER_ENABLED:'true',CAREER_RESUME_ONLY:'true',CAREER_RESUME_ENABLED:'true',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'fake',GOOGLE_MAIL_CLIENT_ID:'client',GOOGLE_MAIL_CLIENT_SECRET:'secret',MAIL_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
const call=(path,method='GET',body)=>onRequest({env,params:{path:path.split('?')[0].split('/')},request:new Request('https://cpaping.com/api/career/'+path,{method,headers:{Authorization:'Bearer fake','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})});
test('history and manual result RPCs bind authenticated owner and ignore supplied owner/source',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,opt)=>{if(String(url).includes('/auth/'))return json({id:uid,email_confirmed_at:'yes'});calls.push({url:String(url),body:JSON.parse(opt.body)});return json([]);});
 assert.equal((await call('application-history?status=review&mode=auto&result=passed&search=test&offset=25')).status,200);assert.deepEqual(calls[0].body,{p_user:uid,p_offset:25,p_status:'review',p_mode:'auto',p_result:'passed',p_search:'test',p_id:null});
 assert.equal((await call('deliveries/'+other+'/result','PUT',{user_id:other,source:'mail',result:'passed',version:0})).status,200);assert.equal(calls[1].body.p_user,uid);assert.equal(calls[1].body.p_source,'manual');
 assert.equal((await call('application-history?status=evil')).status,400);assert.equal((await call('application-history?offset=-1')).status,400);assert.equal((await call('deliveries/'+other+'/result','PUT',{result:'passed'})).status,400);
});
test('resume state exposes current and pending file only while archive remains in DB',async t=>{
 t.mock.method(globalThis,'fetch',async url=>{url=String(url);if(url.includes('/auth/'))return json({id:uid,email_confirmed_at:'yes'});if(url.includes('career_files'))return json([{id:uid,name:'current.pdf'},{id:other,name:'old.pdf'}]);if(url.includes('career_rules'))return json([{resume_file_id:uid}]);return json([]);});
 const r=await call('resume-state');assert.equal(r.status,200);const state=await r.json();assert.deepEqual(state.files,[{id:uid,name:'current.pdf'}]);
});
test('draft payload permits incomplete content but excludes active-send consent and foreign fields',async t=>{
 let payload;t.mock.method(globalThis,'fetch',async(url,opt)=>String(url).includes('/auth/')?json({id:uid,email_confirmed_at:'yes'}):(payload=JSON.parse(opt.body),json([{}])));
 assert.equal((await call('resume-draft','PUT',{version:0,data:{resume_file_id:other,applicant_name:'',subject:'unfinished {',body:'',employment:[],mode:'auto',enabled:true,auto_consent:true,user_id:other}})).status,200);assert.equal(payload.p_user,uid);assert.equal(payload.p_data.auto_consent,undefined);assert.equal(payload.p_data.user_id,undefined);assert.equal(payload.p_data.enabled,true);
});
test('Gmail callback records read consent only when granted and exposes no refresh/access token',async t=>{
 const state='a'.repeat(43),verifier=await seal(env,uid,'verifier');let saved;
 t.mock.method(globalThis,'fetch',async(url,opt)=>{url=String(url);if(url.includes('career_oauth_states'))return json([{user_id:uid,provider:'google',verifier_encrypted:verifier}]);if(url.includes('oauth2.googleapis.com/token'))return json({access_token:'secret-access',refresh_token:'secret-refresh',scope:'openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly'});if(url.includes('userinfo'))return json({email:'me@example.com',email_verified:true});saved=JSON.parse(opt.body);return json([]);});
 const request=new Request('https://cpaping.com/api/career/mail-callback?state='+state+'&code=one',{headers:{Cookie:'career_oauth='+state}});const r=await onRequest({env,params:{path:['mail-callback']},request});assert.equal(r.status,303);assert.equal(r.headers.get('Location'),'/resume/?mail=connected');assert.equal(saved.reply_read_enabled,true);assert.equal(saved.access_token,undefined);assert.ok(!JSON.stringify([...r.headers]).includes('secret'));
});
test('automation endpoint binds owner and validates booleans, mode and version before mutation',async t=>{
 let payload,calls=0;t.mock.method(globalThis,'fetch',async(url,opt)=>String(url).includes('/auth/')?json({id:uid,email_confirmed_at:'yes'}):(calls++,payload=JSON.parse(opt.body),json({rule:{enabled:false},draft:null})));
 const data={enabled:false,mode:'review',updated_at:'2026-09-15T00:00:00Z',user_id:other};const r=await call('resume-automation','PUT',data);assert.equal(r.status,200);assert.equal((await r.json()).rule.enabled,false);assert.deepEqual(payload,{p_user:uid,p_enabled:false,p_mode:'review',p_expected:data.updated_at,p_consent:null});
 for(const patch of [{enabled:'true'},{mode:'invalid'},{updated_at:null},{updated_at:'bad'}])assert.equal((await call('resume-automation','PUT',{...data,...patch})).status,400);assert.equal(calls,1);
});
