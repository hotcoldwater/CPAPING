import {requireUser,supabase} from '../../_shared.js';
import {reply,body,fail} from '../../_career.js';
export function validateMember(b) {
 if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(key=>key!=='nickname'))throw fail('현재 닉네임만 변경할 수 있습니다. 새로고침 후 다시 시도해 주세요.');
 if(typeof b.nickname!=='string')throw fail('닉네임을 입력해 주세요.');
 const nickname=b.nickname.trim();
 if(nickname.length<2||nickname.length>12||/[\x00-\x1f\x7f]/.test(nickname)||/(운영자|관리자|cpaping|공식|admin|official)/i.test(nickname))throw fail('닉네임은 2~12자로, 운영자·공식 등의 문구 없이 입력해 주세요.');
 return {nickname};
}
export async function onRequest({request,env}) {
 try {
  const user=await requireUser(request,env);if(!user?.email_confirmed_at)return reply({error:'로그인과 이메일 인증이 필요합니다.'},401);
  if(request.method==='GET') {
   const [profiles,details]=await Promise.all([supabase(env,`profiles?user_id=eq.${user.id}&select=nickname`),supabase(env,`member_details?user_id=eq.${user.id}&select=user_id&limit=1`)]);
   return reply({nickname:profiles[0]?.nickname||null,has_saved_details:details.length>0});
  }
  if(request.method==='DELETE'){await supabase(env,`member_details?user_id=eq.${user.id}`,{method:'DELETE'});return reply({ok:true});}
  if(request.method!=='PUT')return reply({error:'지원하지 않는 요청입니다.'},405);
  const values=validateMember(await body(request,4000));
  const rows=await supabase(env,`profiles?user_id=eq.${user.id}&select=nickname`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(values)});
  if(!rows?.length)return reply({error:'회원 정보를 찾지 못했습니다. 다시 로그인해 주세요.'},404);
  return reply({ok:true,...values});
 }catch(e){if(e.status)return reply({error:e.message},e.status);if(/23505|409/.test(e.message))return reply({error:'이미 사용 중인 닉네임입니다.'},409);return reply({error:'정보를 저장하거나 불러오지 못했습니다. 다시 시도해 주세요.'},500);}
}
