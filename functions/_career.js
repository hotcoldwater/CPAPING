import { supabase, requireUser, json } from './_shared.js';
export { supabase };
export const enc = encodeURIComponent;
export const now = () => new Date().toISOString();
export function reply(data, status=200) {
  const r = json(data,status);
  r.headers.set('Cache-Control','private, no-store');
  r.headers.set('X-Content-Type-Options','nosniff');
  r.headers.set('Referrer-Policy','no-referrer');
  return r;
}
export function fail(message, status=400) { return Object.assign(new Error(message), {status}); }
export async function identity(request, env) {
  if (env.CAREER_ENABLED !== 'true') throw fail('지원 작업공간을 준비 중입니다.',503);
  const user = await requireUser(request,env);
  if (!user?.email_confirmed_at) throw fail('이메일 인증을 마친 계정으로 로그인해 주세요.',401);
  return user;
}
export async function body(request, limit=220000) {
  if (!request.headers.get('Content-Type')?.includes('application/json')) throw fail('JSON 요청이 필요합니다.',415);
  // Content-Length만 믿으면 chunked 요청으로 크기 제한을 우회할 수 있다.
  const reader = request.body?.getReader(); if (!reader) throw fail('내용이 없습니다.');
  let size=0, parts=[];
  while (true) {
    const {value,done}=await reader.read(); if(done) break;
    size+=value.byteLength; if(size>limit) { await reader.cancel(); throw fail('입력 용량을 줄여 주세요.',413); }
    parts.push(value);
  }
  const out=new Uint8Array(size); let at=0; for(const p of parts){out.set(p,at);at+=p.length;}
  try { const value=JSON.parse(new TextDecoder().decode(out)); if (!value || Array.isArray(value) || typeof value!=='object') throw 0; return value; }
  catch { throw fail('입력 형식이 올바르지 않습니다.'); }
}
export function textValue(value,max=5000) { if(typeof value!=='string' || value.length>max) throw fail('입력 길이나 형식을 확인해 주세요.'); return value.trim(); }
export function uuid(v) { if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v||'')) throw fail('항목 번호가 올바르지 않습니다.'); return v; }
export async function owned(env,table,user,id,select='*') {
  const rows=await supabase(env,`${table}?user_id=eq.${enc(user)}&id=eq.${enc(uuid(id))}&select=${select}`);
  if(!rows?.[0]) throw fail('항목을 찾을 수 없습니다.',404); return rows[0];
}
export async function patch(env,table,query,data) {
  return supabase(env,`${table}?${query}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(data)});
}
export async function insert(env,table,data) {
  return supabase(env,table,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(data)});
}
export async function enqueue(env,user,kind,input) {
  try { return (await supabase(env,'rpc/career_enqueue',{method:'POST',body:JSON.stringify({p_user:user,p_kind:kind,p_input:input})}))[0]; }
  catch(e) { if(/career_.*_limit/.test(e.message)) throw fail('하루 30회, 동시에 3개까지 처리합니다. 진행 중인 작업이 끝난 뒤 다시 시도해 주세요.',429); throw e; }
}
export function base64(bytes) { let s=''; for(const b of bytes)s+=String.fromCharCode(b); return btoa(s); }
export function unbase64(s) { return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }
export function random() { return base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
export async function seal(env,user,value) {
  const bytes=unbase64(env.MAIL_TOKEN_KEY||''); if(bytes.length!==32) throw fail('메일 연결 암호화 설정이 필요합니다.',503);
  const key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(user)},key,new TextEncoder().encode(value));
  return base64(iv)+'.'+base64(new Uint8Array(cipher));
}
export async function unseal(env,user,value) {
  const [iv,data]=value.split('.'); const key=await crypto.subtle.importKey('raw',unbase64(env.MAIL_TOKEN_KEY),'AES-GCM',false,['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv),additionalData:new TextEncoder().encode(user)},key,unbase64(data)));
}
export function provider(env,id) {
  if(id==='google') return {id,client:env.GOOGLE_MAIL_CLIENT_ID,secret:env.GOOGLE_MAIL_CLIENT_SECRET,
    authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',
    scope:'openid email https://www.googleapis.com/auth/gmail.send',profile:'https://openidconnect.googleapis.com/v1/userinfo'};
  if(id==='microsoft') return {id,client:env.MICROSOFT_MAIL_CLIENT_ID,secret:env.MICROSOFT_MAIL_CLIENT_SECRET,
    authorize:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',token:'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope:'openid email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send',profile:'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName'};
  throw fail('지원하지 않는 메일 서비스입니다.');
}
export function callback(env) {
  const origin=env.CAREER_ORIGIN || 'https://cpaping.com';
  const u=new URL(origin); if(u.protocol!=='https:') throw fail('메일 연결 주소 설정을 확인해 주세요.',503);
  return u.origin+'/api/career/mail-callback';
}
export function validateProfile(data) {
  if(!data || typeof data!=='object' || Array.isArray(data) || JSON.stringify(data).length>160000) throw fail('작성 자료의 형식이나 크기를 확인해 주세요.');
  const allowed=['identity','sheets','essay','ai_consent','ai_consent_provider','facts_confirmed'];
  if(Object.keys(data).some(k=>!allowed.includes(k))) throw fail('알 수 없는 작성 항목입니다.');
  if(data.essay!==undefined) textValue(data.essay,20000);
  if(data.identity && (Array.isArray(data.identity)||typeof data.identity!=='object')) throw fail('기본 정보를 확인해 주세요.');
  return data;
}
export function validateFilters(raw) {
  const f={};
  for(const k of ['firms','regions','types','employment','keywords','exclude']) {
    const a=raw?.[k] || [];
    if(!Array.isArray(a)||a.length>50||a.some(x=>typeof x!=='string'||x.length>100)) throw fail('필터 값을 확인해 주세요.');
    f[k]=[...new Set(a.map(x=>x.trim()).filter(Boolean))];
  }
  if(f.regions.some(x=>!['capital','local','any'].includes(x))) throw fail('지역 필터를 확인해 주세요.');
  if(f.types.some(x=>!['entry','mixed','any','experienced','partner','ambiguous'].includes(x))) throw fail('지원 자격을 확인해 주세요.');
  for(const k of ['revenue_min','revenue_max','experience_years']) {
    const v=raw?.[k]; f[k]=v===null||v===''||v===undefined?null:Number(v);
    if(f[k]!==null&&(!Number.isFinite(f[k])||f[k]<0||f[k]>1000000)) throw fail('매출·경력 숫자를 확인해 주세요.');
  }
  if(f.revenue_min!==null&&f.revenue_max!==null&&f.revenue_min>f.revenue_max) throw fail('최소 매출이 최대 매출보다 큽니다.');
  f.all_firms=raw?.all_firms===true;
  if(!f.firms.length&&!f.all_firms) throw fail('관심 법인을 선택하거나 모든 법인 검색에 동의해 주세요.');
  return f;
}
