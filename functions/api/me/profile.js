import {requireUser,supabase} from '../../_shared.js';
import {reply,body,fail} from '../../_career.js';
export function validateMember(b) {
 const text=(key,max)=>{if(b[key]==null||b[key]==='')return null;if(typeof b[key]!=='string'||b[key].trim().length>max||/[\x00-\x1f\x7f]/.test(b[key]))throw fail('입력 길이와 형식을 확인해 주세요.');return b[key].trim()||null;};
 const nickname=text('nickname',12),full_name=text('full_name',80),phone=text('phone',30),school=text('school',120),birth_date=text('birth_date',10);
 if(nickname&&(nickname.length<2||/(운영자|관리자|cpaping|공식|admin|official)/i.test(nickname)))throw fail('닉네임은 2~12자로, 운영자·공식 등의 문구 없이 입력해 주세요.');
 if(phone&&!/^[+0-9() .-]{5,30}$/.test(phone))throw fail('전화번호 형식을 확인해 주세요.');
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
 if(birth_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(birth_date)||!Number.isFinite(Date.parse(birth_date))||new Date(birth_date).toISOString().slice(0,10)!==birth_date||birth_date<'1900-01-01'||birth_date>today))throw fail('생년월일을 확인해 주세요.');
 const pass_year=b.pass_year==null||b.pass_year===''?null:b.pass_year;
 if(pass_year!==null&&(!Number.isInteger(pass_year)||pass_year<1950||pass_year>Number(today.slice(0,4))))throw fail('합격년도를 확인해 주세요.');
 if(b.research_consent!==true)throw fail('정보를 저장하려면 채용 인사이트 연구 참여에 동의해 주세요.');
 return {nickname,full_name,birth_date,phone,school,pass_year,research_consent:b.research_consent};
}
export async function onRequest({request,env}) {
 try {
  const user=await requireUser(request,env);if(!user?.email_confirmed_at)return reply({error:'로그인과 이메일 인증이 필요합니다.'},401);
  if(request.method==='GET') {
   const [profiles,details]=await Promise.all([supabase(env,`profiles?user_id=eq.${user.id}&select=nickname`),supabase(env,`member_details?user_id=eq.${user.id}&select=full_name,birth_date,phone,school,pass_year,research_consent,updated_at`)]);
   return reply({nickname:profiles[0]?.nickname||null,...(details[0]||{research_consent:false})});
  }
  if(request.method==='DELETE'){await supabase(env,`member_details?user_id=eq.${user.id}`,{method:'DELETE'});return reply({ok:true});}
  if(request.method!=='PUT')return reply({error:'지원하지 않는 요청입니다.'},405);
  const values=validateMember(await body(request,4000));
  await supabase(env,'rpc/save_member_details',{method:'POST',body:JSON.stringify({p_user:user.id,...Object.fromEntries(Object.entries(values).map(([k,v])=>['p_'+k,v]))})});
  return reply({ok:true,...values});
 }catch(e){if(e.status)return reply({error:e.message},e.status);if(/23505|409/.test(e.message))return reply({error:'이미 사용 중인 닉네임입니다.'},409);return reply({error:'정보를 저장하거나 불러오지 못했습니다. 다시 시도해 주세요.'},500);}
}
