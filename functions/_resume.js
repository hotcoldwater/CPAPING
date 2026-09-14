import {body,enc,fail,insert,now,owned,patch,reply,supabase,textValue,uuid,validateFilters} from './_career.js';
const FLOW='uploaded-resume-v1';
const pdf='application/pdf',docx='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const rpc=(env,name,data)=>supabase(env,'rpc/'+name,{method:'POST',body:JSON.stringify(data)});
export function resumeUpload(b){
 const name=textValue(b.name,100),data=b.data_base64;
 if(!/\.(pdf|docx)$/i.test(name)||/[\x00-\x1f\x7f/\\]/.test(name)||typeof data!=='string'||data.length>4000000||data.length%4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw fail('3MB 이하의 PDF 또는 Word(.docx) 이력서를 선택해 주세요.');
 let raw;try{raw=atob(data);}catch{throw fail('파일 내용을 읽지 못했습니다.');}
 const isPdf=/\.pdf$/i.test(name);
 if(raw.length<8||raw.length>3000000||!(isPdf?raw.startsWith('%PDF-'):raw.startsWith('PK\x03\x04')))throw fail('확장자와 파일 내용이 맞지 않습니다. PDF 또는 Word 파일을 확인해 주세요.');
 return {name,mime:isPdf?pdf:docx,data_base64:data};
}
export function mailTemplate(v,max,subject=false){
 const text=textValue(v,max);
 if(!text||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)||(subject&&/[\r\n]/.test(text))||/[{}]/.test(text.replace(/\{(?:이름|법인|공고)\}/g,'')))throw fail('메일 문구와 치환 항목을 확인해 주세요. [회계법인], {이름}, {공고}를 사용할 수 있습니다. 기존 {법인}도 지원합니다.');
 return text;
}
export async function resumeRequest(request,env,user,path){
 const method=request.method,uid=enc(user.id);
 if(env.CAREER_RESUME_ONLY!=='true'||env.CAREER_RESUME_ENABLED!=='true')throw fail('이력서 지원 기능을 준비 중입니다.',503);
 try{
 if(path==='resume-state'&&method==='GET'){
  const [files,rules,apps]=await Promise.all([
   supabase(env,`career_files?user_id=eq.${uid}&kind=eq.resume&select=id,name,mime,created_at&order=created_at.desc`),
   supabase(env,`career_rules?user_id=eq.${uid}&select=resume_file_id,applicant_name,mail_subject_template,mail_body_template,enabled,mode,filters,daily_limit,updated_at,enabled_since`),
   supabase(env,`career_applications?select=*,career_review_notices(status,sent_at)&user_id=eq.${uid}&snapshot->>flow=eq.${FLOW}&status=not.in.(sent,cancelled)&order=created_at.desc&limit=100`)]);
  return reply({files,rule:rules[0]||null,applications:apps,limit:100});
 }
 if(path==='resumes'&&method==='POST'){
  const f=resumeUpload(await body(request,4100000));
  const id=await rpc(env,'career_upload_resume',{p_user:user.id,p_name:f.name,p_mime:f.mime,p_data:f.data_base64});return reply({id,name:f.name},201);
 }
 if(path.startsWith('resumes/')&&method==='DELETE'){
  await rpc(env,'career_delete_resume',{p_user:user.id,p_file:uuid(path.split('/')[1])});return reply({ok:true});
 }
 if(path==='resume-stop'&&method==='POST'){
  await rpc(env,'career_pause_resume',{p_user:user.id});return reply({ok:true});
 }
 if(path==='resume-rule'&&method==='PUT'){
  const b=await body(request),name=textValue(b.applicant_name,80),filters=validateFilters(b.filters);
  if(!name||/[\r\n\x00-\x1f]/.test(name)||!['auto','review'].includes(b.mode)||typeof b.enabled!=='boolean'||!Number.isInteger(b.daily_limit)||b.daily_limit<1||b.daily_limit>20||b.file_confirmed!==true)throw fail('이름·발송 방식·하루 한도와 이력서 내용 확인 항목을 확인해 주세요.');
  const subject=mailTemplate(b.subject,200,true),mailBody=mailTemplate(b.body,10000);
  if(b.mode==='auto'&&b.enabled&&b.auto_consent!==true)throw fail('조건에 맞는 공고에 개인 메일로 자동 발송하는 것에 동의해 주세요.');
  const rows=await rpc(env,'career_save_resume_rule',{p_user:user.id,p_file:uuid(b.resume_file_id),p_name:name,p_subject:subject,p_body:mailBody,p_filters:filters,p_mode:b.mode,p_enabled:b.enabled,p_limit:b.daily_limit,p_consent:b.auto_consent===true?'resume-auto-v1':null,p_expected:b.updated_at||null});return reply(rows[0]);
 }
 if(path==='resume-applications'&&method==='POST'){
  const b=await body(request),id=String(b.posting_id||'');if(!/^\d{1,15}$/.test(id))throw fail('지원할 공고를 선택해 주세요.');
  const rule=(await supabase(env,`career_rules?user_id=eq.${uid}`))[0];if(!rule?.resume_file_id)throw fail('이력서와 지원 설정을 먼저 저장해 주세요.');
  const post=(await supabase(env,`job_postings?id=eq.${id}`))[0];
  if(!post||post.is_expired||post.removed_at)throw fail('현재 지원할 수 없는 공고입니다.');
  const app=(await insert(env,'career_applications',{user_id:user.id,posting_id:post.id,canonical_posting_id:post.original_id||post.id,origin:'manual',snapshot:{flow:FLOW}}))[0];return reply(app,202);
 }
 if(path.startsWith('resume-applications/')&&method==='PUT'){
  const a=await owned(env,'career_applications',user.id,path.split('/')[1]),b=await body(request);
  if(a.snapshot?.flow!==FLOW||!['review','blocked','preparing','queued','failed'].includes(a.status)||b.version!==a.version)throw fail('지원 상태가 바뀌었습니다. 새로고침 후 확인해 주세요.',409);
  const data={version:a.version+1,updated_at:now()};
  if(b.action==='cancel'){data.status='cancelled';data.reason='사용자가 취소했습니다.';}
  else if(b.action==='prepare'){if(a.status==='queued')throw fail('발송 대기 중에는 다시 준비할 수 없습니다.');data.status='preparing';data.reason=null;data.snapshot={flow:FLOW};data.document_id=null;}
  else if(b.action==='approve'){
   if(a.status!=='review'||!a.document_id||b.reviewed!==true)throw fail('공고 원문, 수신자, 메일 문구와 이력서를 확인해 주세요.');
   const recipient=textValue(b.recipient,254);if(!(a.snapshot.allowed_recipients||[]).includes(recipient))throw fail('원문에서 확인된 지원 이메일을 선택해 주세요.');
   const rule=(await supabase(env,`career_rules?user_id=eq.${uid}`))[0];
   if(!rule||rule.updated_at!==a.snapshot.rule_updated_at||rule.resume_file_id!==a.document_id)throw fail('이력서나 설정이 바뀌었습니다. 다시 준비해 주세요.',409);
   const account=(await supabase(env,`career_mail_accounts?user_id=eq.${uid}&select=email,connected_at`))[0];
   if(!account||account.email!==a.snapshot.sender_email||account.connected_at!==a.snapshot.sender_connected_at)throw fail('발신 계정이 바뀌었습니다. 다시 준비해 주세요.',409);
   data.subject=textValue(b.subject,200);data.body=textValue(b.body,10000);
   if(!data.subject||/[\r\n\x00-\x1f]/.test(data.subject)||!data.body)throw fail('메일 제목과 본문을 확인해 주세요.');
   data.recipient=recipient;data.status='queued';data.approved_at=now();data.reason=null;data.snapshot={...a.snapshot,auto:false,requirements_reviewed:true};
  }else throw fail('지원 작업을 확인해 주세요.');
  const rows=await patch(env,'career_applications',`id=eq.${a.id}&user_id=eq.${uid}&version=eq.${a.version}&status=eq.${a.status}`,data);if(!rows.length)throw fail('지원 상태가 바뀌었습니다. 새로고침해 주세요.',409);return reply(rows[0]);
 }
 return reply({error:'지원하지 않는 요청입니다.'},404);
 }catch(e){
  for(const [key,msg,status] of [['resume_conflict','다른 창에서 설정이 바뀌었습니다. 새로고침해 주세요.',409],['resume_file_limit','이력서는 20개까지 보관합니다. 사용하지 않는 파일을 삭제해 주세요.',400],['resume_in_use','지원 이력이나 현재 설정에서 사용하는 파일은 삭제할 수 없습니다.',409],['resume_missing','본인의 이력서 파일을 선택해 주세요.',400],['resume_consent','개인 메일 연결과 자동 발송 동의가 필요합니다.',400],['resume_invalid','이력서와 설정 값을 확인해 주세요.',400]])if(e.message.includes(key))throw fail(msg,status);
  throw e;
 }
}
