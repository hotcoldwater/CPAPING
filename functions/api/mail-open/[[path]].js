import {supabase} from '../../_shared.js';
const pixel=Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0));
export async function onRequest({request,env,params}) {
  // 응답은 토큰 유효성이나 DB 상태와 관계없이 같다. HEAD는 기록하지 않는다. GET으로 자동 로딩된 이미지는 실제 열람과 구분할 수 없다.
  if(request.method==='GET') {
    const path=Array.isArray(params.path)?params.path.join('/'):params.path||'';
    const token=/^([A-Za-z0-9_-]{43})\.gif$/.exec(path)?.[1];
    if(token)try{
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');
      await supabase(env,'rpc/career_record_open',{method:'POST',body:JSON.stringify({p_hash:hash})});
    }catch{/* 인증 정보나 수신자 데이터는 로그에 남기지 않는다. */}
  }
  return new Response(request.method==='HEAD'?null:pixel,{status:200,headers:{'Content-Type':'image/gif','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
}
