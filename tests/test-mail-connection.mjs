import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/api/career/[[path]].js';
import {seal,unseal} from '../functions/_career.js';

const uid='11111111-1111-4111-8111-111111111111';
const env={CAREER_ENABLED:'true',CAREER_MAIL_ONLY:'true',CAREER_ORIGIN:'https://cpaping.com',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'fake',GOOGLE_MAIL_CLIENT_ID:'test.apps.googleusercontent.com',GOOGLE_MAIL_CLIENT_SECRET:'fake',MAIL_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
function request(path,method='GET',body){return {request:new Request('https://cpaping.com/api/career/'+path,{method,headers:{Authorization:'Bearer test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,params:{path:path.split('/')}};}

test('mail-only beta refuses every writing, AI, document and application route before external calls',async(t)=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('unexpected fetch');});
 for(const [path,method] of [['profile','PUT'],['jobs','POST'],['rules','PUT'],['applications','POST'],['applications/'+uid,'PUT'],['templates','POST'],['templates/'+uid,'PUT'],['files/'+uid,'GET'],['workspace','DELETE']]){
  const r=await onRequest(request(path,method,method==='GET'?undefined:{}));assert.equal(r.status,503,path);
 }
});
test('mail state authenticates and selects only owner metadata, never encrypted tokens',async(t)=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url)=>{calls.push(String(url));return String(url).includes('/auth/')?json({id:uid,email_confirmed_at:'yes'}):json([{email:'self@example.com',provider:'google'}]);});
 const r=await onRequest(request('state'));const body=await r.json();
 assert.equal(r.status,200);assert.equal(body.mail_only,true);assert.equal(body.mail.email,'self@example.com');
 assert.equal(calls.length,2);assert.match(calls[1],new RegExp('user_id=eq.'+uid));assert.match(calls[1],/select=provider,email,connected_at/);assert.match(r.headers.get('Cache-Control'),/no-store/);
});
test('anonymous mail connection is rejected before DB access',async(t)=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('unexpected fetch');});
 const input=request('mail-connect','POST',{provider:'google'});input.request.headers.delete('Authorization');
 assert.equal((await onRequest(input)).status,401);
});
test('Gmail connection stores encrypted PKCE and binds redirect to browser cookie',async(t)=>{
 let saved;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).includes('/auth/'))return json({id:uid,email_confirmed_at:'yes'});
  if(options.method==='POST')saved=JSON.parse(options.body);
  return json([]);
 });
 const r=await onRequest(request('mail-connect','POST',{provider:'google'}));assert.equal(r.status,200);
 const u=new URL((await r.json()).url);assert.equal(u.origin,'https://accounts.google.com');assert.equal(u.searchParams.get('redirect_uri'),'https://cpaping.com/api/career/mail-callback');
 assert.equal(u.searchParams.get('access_type'),'offline');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(u.searchParams.get('state'),saved.id);
 assert.match(r.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Lax/);
 const verifier=await unseal(env,uid,saved.verifier_encrypted);
 assert.equal(u.searchParams.get('code_challenge'),Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url'));
});
test('callback saves only encrypted refresh token and returns to test page without sending',async(t)=>{
 const state='a'.repeat(43),verifier=await seal(env,uid,'test-verifier');let saved;const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  url=String(url);calls.push(url);
  if(url.includes('career_oauth_states'))return json([{user_id:uid,provider:'google',verifier_encrypted:verifier}]);
  if(url==='https://oauth2.googleapis.com/token')return json({access_token:'access',refresh_token:'refresh',scope:'openid email https://www.googleapis.com/auth/gmail.send'});
  if(url==='https://openidconnect.googleapis.com/v1/userinfo')return json({email:'self@example.com',email_verified:true});
  if(url.includes('career_mail_accounts')){saved=JSON.parse(options.body);return json([]);}
  throw new Error('unexpected endpoint');
 });
 const input=request('mail-callback?state='+state+'&code=single-use');input.params.path=['mail-callback'];input.request.headers.set('Cookie','career_oauth='+state);
 const r=await onRequest(input);assert.equal(r.status,303);assert.equal(r.headers.get('Location'),'/mail-connect/?mail=connected');
 assert.equal(saved.user_id,uid);assert.equal(await unseal(env,uid,saved.token_encrypted),'refresh');assert.equal(saved.access_token,undefined);
 assert.equal(calls.length,4);assert.ok(calls.every(x=>!x.includes('/messages/send')));
});
test('callback with mismatched browser state never exchanges authorization code',async(t)=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('unexpected fetch');});
 const input=request('mail-callback?state='+'a'.repeat(43));input.params.path=['mail-callback'];input.request.headers.set('Cookie','career_oauth='+'b'.repeat(43));
 assert.equal((await onRequest(input)).status,400);
});
test('partial consent and missing refresh token return distinct retry outcomes without storing credentials',async(t)=>{
 const state='a'.repeat(43),verifier=await seal(env,uid,'test-verifier');
 const cases=[
  [{scope:'openid email',refresh_token:'private-refresh'},'missing_send_permission'],
  [{scope:'openid email'},'missing_send_permission'],
  [{scope:'https://example.com/gmail.send',refresh_token:'private-refresh'},'missing_send_permission'],
  [{scope:'https://www.googleapis.com/auth/gmail.send'},'missing_refresh_token'],
  [{scope:'https://www.googleapis.com/auth/gmail.send',refresh_token:'  '},'missing_refresh_token']
 ];
 for(const [tokens,outcome] of cases){
  await t.test(outcome+' '+JSON.stringify(Object.keys(tokens)),async(t)=>{
   const calls=[];
   t.mock.method(globalThis,'fetch',async(url,options)=>{
    url=String(url);calls.push([url,options.method]);
    if(url.includes('career_oauth_states'))return json([{user_id:uid,provider:'google',verifier_encrypted:verifier}]);
    if(url==='https://oauth2.googleapis.com/token')return json({...tokens,access_token:'private-access'});
    throw new Error('incomplete consent must not read profile, save account or send mail');
   });
   const input=request('mail-callback?state='+state+'&code=private-code');input.params.path=['mail-callback'];input.request.headers.set('Cookie','career_oauth='+state);
   const r=await onRequest(input);assert.equal(r.status,303);assert.equal(r.headers.get('Location'),'/mail-connect/?mail='+outcome);
   assert.match(r.headers.get('Set-Cookie'),/Max-Age=0/);assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');assert.equal(r.headers.get('Cache-Control'),'no-store');
   assert.equal(await r.text(),'');assert.equal(calls.length,2);assert.equal(calls[0][1],'DELETE');
   assert.ok(!JSON.stringify([...r.headers]).includes('private-'));
  });
 }
});
test('disconnect deletes tokens and pending state even when Google revocation is unavailable',async(t)=>{
 const encrypted=await seal(env,uid,'refresh'),calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  url=String(url);calls.push([url,options?.method||'GET']);
  if(url.includes('/auth/'))return json({id:uid,email_confirmed_at:'yes'});
  if(url.includes('career_mail_accounts')&&(!options?.method||options.method==='GET'))return json([{provider:'google',token_encrypted:encrypted}]);
  if(url.includes('oauth2.googleapis.com/revoke'))throw new Error('offline');
  return json([]);
 });
 const r=await onRequest(request('mail','DELETE'));assert.equal(r.status,200);
 for(const table of ['career_mail_accounts','career_oauth_states'])assert.ok(calls.some(([url,method])=>url.includes(table)&&url.includes('user_id=eq.'+uid)&&method==='DELETE'));
});
