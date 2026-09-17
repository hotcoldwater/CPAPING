import {body,enc,fail,insert,now,owned,patch,reply,supabase,textValue,uuid} from './_career.js';
const FLOW='uploaded-resume-v1';
const pdf='application/pdf',docx='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const rpc=(env,name,data)=>supabase(env,'rpc/'+name,{method:'POST',body:JSON.stringify(data)});
export function resumeFilters(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>k!=='employment'))throw fail('지원 조건이 변경되었습니다. 새로고침 후 풀타임·파트타임을 선택해 주세요.');
 if(!Array.isArray(raw.employment)||raw.employment.length<1||raw.employment.length>2||raw.employment.some(v=>!['Full Time','Part Time'].includes(v)))throw fail('풀타임 또는 파트타임을 하나 이상 선택해 주세요.');
 return {scope:'trainee-employment-v1',employment:['Full Time','Part Time'].filter(v=>raw.employment.includes(v))};
}
export function resumeUpload(b){
 const name=textValue(b.name,100),data=b.data_base64;
 if(!/\.(pdf|docx)$/i.test(name)||/[\x00-\x1f\x7f/\\]/.test(name)||typeof data!=='string'||data.length>4000000||data.length%4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw fail('3MB 이하의 PDF 또는 Word(.docx) 이력서를 선택해 주세요.');
 let raw;try{raw=atob(data);}catch{throw fail('파일 내용을 읽지 못했습니다.');}
 const isPdf=/\.pdf$/i.test(name);
 if(raw.length<8||raw.length>3000000||!(isPdf?raw.startsWith('%PDF-'):raw.startsWith('PK\x03\x04')))throw fail('확장자와 파일 내용이 맞지 않습니다. PDF 또는 Word 파일을 확인해 주세요.');
 return {name,mime:isPdf?pdf:docx,data_base64:data};
}
export function applicationUpload(b){
 if(/\.(pdf|docx)$/i.test(b.name||''))return resumeUpload(b);
 const name=textValue(b.name,100),ext=name.split('.').pop().toLowerCase();
 const types={hwp:'application/x-hwp',hwpx:'application/hwp+zip',doc:'application/msword',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
 if(!types[ext]||/[\x00-\x1f\x7f/\\]/.test(name)||typeof b.data_base64!=='string'||b.data_base64.length>4000000)throw fail('PDF, Word, 한글, Excel, PNG 또는 JPG 파일을 올려 주세요.');
 let raw;try{raw=atob(b.data_base64);}catch{throw fail('파일 내용을 읽지 못했습니다.');}
 const matches=['hwp','doc','xls'].includes(ext)?raw.startsWith('\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'):['hwpx','xlsx'].includes(ext)?raw.startsWith('PK\x03\x04'):ext==='png'?raw.startsWith('\x89PNG\r\n\x1a\n'):raw.startsWith('\xff\xd8\xff');
 if(raw.length<8||raw.length>3000000||!matches)throw fail('파일 내용과 확장자를 확인해 주세요. 파일당 최대 3MB입니다.');
 return {name,mime:types[ext],data_base64:b.data_base64};
}
export function mailTemplate(v,max,subject=false){
 const text=textValue(v,max);
 if(!text||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)||(subject&&/[\r\n]/.test(text))||/[{}]/.test(text.replace(/\{(?:이름|법인|공고)\}/g,'')))throw fail('메일 문구와 치환 항목을 확인해 주세요. [회계법인], [이름], [공고]를 사용할 수 있습니다.');
 return text;
}
// Materialize templates for the editor without replacing the stored template.
export function renderApplicationMail(template,rule,post,member={}){
 const values={'이름':rule.applicant_name,'회계법인':post.company_name,'법인':post.company_name,'공고':post.title,'출생년도':String(member.birth_date||'').slice(0,4),'합격년도':String(member.pass_year||'')};
 return String(template||'').replace(/\[(회계법인|이름|공고)\]|\{(이름|법인|공고|출생년도|합격년도)\}/g,(_,a,b)=>{if(!values[a||b])throw fail('메일에 필요한 '+(a||b)+' 정보를 확인해 주세요.');return values[a||b];});
}
async function directApplication(env,user,rule,post){
 const analysis=post.application_analysis||{},reasons=[...(analysis.uncertainty||[]),...(analysis.blockers||[])];
 if(!analysis.state)reasons.push('지원 요건을 확인하지 못했습니다. 공고를 확인하고 직접 작성해 주세요.');
 if(analysis.documents?.kind==='designated')reasons.push('공고의 지정 지원서 양식을 작성해 주세요.');
 if(analysis.method==='website')reasons.push('지원 사이트에서 직접 접수해야 합니다.');
 if(analysis.file_format==='unsupported')reasons.push('요구하는 파일 형식을 직접 준비해 주세요.');
 if(!analysis.recipient&&analysis.method!=='website')reasons.push('공고에서 지원 이메일을 확인해 주세요.');
 const member=(await supabase(env,`member_details?user_id=eq.${enc(user.id)}`))[0]||{};
 const render=t=>renderApplicationMail(t,rule,post,member);
 let subject=render(rule.mail_subject_template),mailBody=render(rule.mail_body_template);
 if(analysis.subject?.kind==='designated')try{subject=render(analysis.subject.template);}catch(e){reasons.push(e.message);}
 const id=analysis.file_format==='docx'?rule.resume_docx_file_id:rule.resume_file_id;
 const file=id?(await supabase(env,`career_files?id=eq.${uuid(id)}&user_id=eq.${enc(user.id)}&select=id,name,mime`))[0]:null;
 let name=file?.name;
 if(!file)reasons.push('요구하는 형식의 지원서 파일을 업로드해 주세요.');
 else if(analysis.filename?.kind==='designated')try{name=render(analysis.filename.template).replace(/\.(pdf|docx)$/i,'')+(file.mime===pdf?'.pdf':'.docx');}catch(e){reasons.push(e.message);}
 const snapshot={flow:FLOW,company:post.company_name,title:post.title,posting_ij_id:post.ij_id,detail_url:post.detail_url,analysis,auto:false,requirements:reasons,attachments:file?[{id:file.id,name,mime:file.mime}]:[],test_recipient:user.id==='bbcfa2b9-9f2d-447b-84e1-68a55b776f71'||user.email?.toLowerCase()==='ohshsh00@gmail.com'?'leorich21@naver.com':null};
 return {subject,body:mailBody,recipient:analysis.recipient||null,document_id:file?.id||null,snapshot,status:reasons.length?'blocked':'review',reason:[...new Set(reasons)].join('\n')||null};
}
export async function resumeRequest(request,env,user,path){
 const method=request.method,uid=enc(user.id);
 if(env.CAREER_RESUME_ONLY!=='true'||env.CAREER_RESUME_ENABLED!=='true')throw fail('이력서 지원 기능을 준비 중입니다.',503);
 try{
 if(path==='resume-state'&&method==='GET'){
  const [rules,drafts]=await Promise.all([
   supabase(env,`career_rules?user_id=eq.${uid}&select=resume_file_id,resume_docx_file_id,applicant_name,mail_subject_template,mail_body_template,enabled,mode,filters,daily_limit,updated_at,enabled_since,consent_version`),
   supabase(env,`career_resume_drafts?user_id=eq.${uid}`)]);
  const rule=rules[0]||null,draft=drafts[0]||null,ids=[...new Set([rule?.resume_file_id,rule?.resume_docx_file_id,draft?.data?.resume_file_id,draft?.data?.resume_docx_file_id].filter(Boolean))].map(uuid);
  const files=ids.length?await supabase(env,`career_files?user_id=eq.${uid}&kind=eq.resume&id=in.(${ids.join(',')})&select=id,name,mime,created_at`):[];
  return reply({files:files.filter(f=>ids.includes(f.id)),rule,draft,applications:[],limit:100});
 }
 if(path==='resume-draft'&&method==='PUT'){
  const b=await body(request,16000),d=b.data;
  if(!d||typeof d!=='object'||!Number.isInteger(b.version)||b.version<0)throw fail('작성 중인 내용을 확인해 주세요.');
  const data={resume_docx_file_id:d.resume_docx_file_id?uuid(d.resume_docx_file_id):null,resume_file_id:d.resume_file_id?uuid(d.resume_file_id):null,applicant_name:textValue(d.applicant_name||'',80),subject:textValue(d.subject||'',200),body:textValue(d.body||'',10000),employment:Array.isArray(d.employment)?d.employment.filter(x=>['Full Time','Part Time'].includes(x)):[],mode:d.mode==='auto'?'auto':'review',enabled:d.enabled===true,flow_version:d.flow_version===2?2:1,step:Number.isInteger(d.step)?Math.max(0,Math.min(5,d.step)):0};
  return reply((await rpc(env,'career_save_resume_draft',{p_user:user.id,p_data:data,p_version:b.version,p_base:b.base_rule_updated_at||null}))[0]);
 }
 if(path==='resume-draft'&&method==='DELETE'){
  const b=await body(request);if(!Number.isInteger(b.version))throw fail('작성 버전을 확인해 주세요.');
  const rows=await supabase(env,`career_resume_drafts?user_id=eq.${uid}&version=eq.${b.version}`,{method:'DELETE',headers:{Prefer:'return=representation'}});
  if(!rows?.length)throw fail('다른 창에서 작성 내용이 변경되었습니다. 다시 불러와 주세요.',409);return reply({ok:true});
 }
 if(path==='resume-attachments'&&method==='POST'){
  const f=applicationUpload(await body(request,4100000));const id=await rpc(env,'career_upload_attachment',{p_user:user.id,p_name:f.name,p_mime:f.mime,p_data:f.data_base64});return reply({id,name:f.name},201);
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
 if(path==='resume-automation'&&method==='PUT'){
  const b=await body(request);if(typeof b.enabled!=='boolean'||!['review','auto'].includes(b.mode)||typeof b.updated_at!=='string'||!Number.isFinite(Date.parse(b.updated_at)))throw fail('자동 지원 상태와 발송 방식을 확인해 주세요.');
  const result=await rpc(env,'career_set_resume_automation',{p_user:user.id,p_enabled:b.enabled,p_mode:b.mode,p_consent:b.auto_consent===true?'resume-auto-v1':null,p_expected:b.updated_at});return reply(result);
 }
 if(path==='resume-rule'&&method==='PUT'){
  const b=await body(request),name=textValue(b.applicant_name,80),filters=resumeFilters(b.filters);
  if(!name||/[\r\n\x00-\x1f]/.test(name)||!['auto','review'].includes(b.mode)||typeof b.enabled!=='boolean'||b.file_confirmed!==true)throw fail('이름·발송 방식과 이력서 내용 확인 항목을 확인해 주세요.');
  const subject=mailTemplate(b.subject,200,true),mailBody=mailTemplate(b.body,10000);
  if(b.mode==='auto'&&b.enabled&&b.auto_consent!==true)throw fail('조건에 맞는 공고에 개인 메일로 자동 발송하는 것에 동의해 주세요.');
  if(b.draft_version!==undefined&&(!Number.isInteger(b.draft_version)||b.draft_version<1))throw fail('작성 중인 버전을 확인해 주세요.');
  const rows=await rpc(env,'career_save_resume_pair',{p_user:user.id,p_file:uuid(b.resume_file_id),p_docx:uuid(b.resume_docx_file_id),p_name:name,p_subject:subject,p_body:mailBody,p_filters:filters,p_mode:b.mode,p_enabled:b.enabled,p_limit:null,p_consent:b.auto_consent===true?'resume-auto-v1':null,p_expected:b.updated_at||null,...(b.draft_version===undefined?{}:{p_draft_version:b.draft_version})});return reply(rows[0]);
 }
 if(path==='resume-applications'&&method==='POST'){
  const b=await body(request),id=String(b.posting_id||'');if(!/^\d{1,15}$/.test(id))throw fail('지원할 공고를 선택해 주세요.');
  const rule=(await supabase(env,`career_rules?user_id=eq.${uid}`))[0];if(!rule?.resume_file_id)throw fail('이력서와 지원 설정을 먼저 저장해 주세요.');
  const post=(await supabase(env,`job_postings?id=eq.${id}`))[0];
  if(!post||post.is_expired||post.removed_at)throw fail('현재 지원할 수 없는 공고입니다.');
  const canonical=post.original_id||post.id;
  const existing=(await supabase(env,`career_applications?user_id=eq.${uid}&canonical_posting_id=eq.${canonical}`))[0];if(existing)return reply(existing);
  const prepared=await directApplication(env,user,rule,post);
  try{const app=(await insert(env,'career_applications',{user_id:user.id,posting_id:post.id,canonical_posting_id:canonical,origin:'manual',...prepared}))[0];return reply(app,201);}
  catch(e){const concurrent=(await supabase(env,`career_applications?user_id=eq.${uid}&canonical_posting_id=eq.${canonical}`))[0];if(concurrent)return reply(concurrent);throw e;}
 }
 if(path.startsWith('resume-events/')&&method==='GET'){
  const id=uuid(path.split('/')[1]);await owned(env,'career_applications',user.id,id);
  return reply(await supabase(env,`career_application_events?application_id=eq.${id}&user_id=eq.${uid}&order=created_at.asc&limit=100`));
 }
 if(/^resume-applications\/[^/]+\/status$/.test(path)&&method==='PUT'){
  const b=await body(request,2000);
  if(!['review','blocked','sent','passed','final_passed','rejected'].includes(b.status)||!Number.isInteger(b.version)||b.version<1|| (b.applied_on!=null&&!/^\d{4}-\d{2}-\d{2}$/.test(b.applied_on)))throw fail('상태와 지원일을 확인해 주세요.');
  try{return reply((await rpc(env,'career_set_application_status',{p_user:user.id,p_application:uuid(path.split('/')[1]),p_expected:b.version,p_status:b.status,p_applied_on:b.applied_on||null}))[0]);}
  catch(e){if(e.message.includes('application_conflict'))throw fail('지원 상태가 바뀌었거나 발송 처리 중입니다. 새로고침 후 확인해 주세요.',409);if(e.message.includes('application_missing'))throw fail('지원 내역을 찾을 수 없습니다.',404);if(e.message.includes('application_date')||e.message.includes('date/time'))throw fail('사이트에 지원한 날짜를 오늘 이전 날짜로 입력해 주세요.');throw e;}
 }
 if(path.startsWith('resume-applications/')&&method==='PUT'){
  const a=await owned(env,'career_applications',user.id,path.split('/')[1]),b=await body(request);
  if(a.snapshot?.flow!==FLOW||!['review','blocked','preparing','queued','failed','delivery_unknown'].includes(a.status)||b.version!==a.version)throw fail('지원 상태가 바뀌었습니다. 새로고침 후 확인해 주세요.',409);
  if(a.status==='delivery_unknown'&&(b.action!=='approve'||b.delivery_checked!==true))throw fail('보낸편지함에서 발송되지 않았는지 먼저 확인해 주세요.',409);
  const data={version:a.version+1,updated_at:now(),manual_status:null};
  if(b.action==='cancel'){data.status='cancelled';data.reason='사용자가 취소했습니다.';}
  else if(b.action==='prepare'){if(a.status==='queued')throw fail('발송 대기 중에는 다시 준비할 수 없습니다.');data.status='preparing';data.reason=null;data.snapshot={flow:FLOW};data.document_id=null;}
  else if(b.action==='approve'){
   if(!['review','blocked','failed','delivery_unknown'].includes(a.status)||b.reviewed!==true)throw fail('공고 원문, 수신자, 메일 문구와 이력서를 확인해 주세요.');
   if(a.snapshot.analysis?.method==='website')throw fail('사이트 접수 공고입니다. 지원 사이트에서 직접 접수해 주세요.');
   const recipient=textValue(b.recipient,254).toLowerCase();if(!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(recipient))throw fail('지원 이메일을 확인해 주세요.');
   const rule=(await supabase(env,`career_rules?user_id=eq.${uid}`))[0];
   if(!rule)throw fail('지원준비를 먼저 저장해 주세요.');
   const account=(await supabase(env,`career_mail_accounts?user_id=eq.${uid}&select=email,connected_at`))[0];
   if(!account)throw fail('발신 계정이 바뀌었습니다. 다시 준비해 주세요.',409);
   data.subject=textValue(b.subject,200);data.body=textValue(b.body,10000);
   if(!data.subject||/[\r\n\x00-\x1f]/.test(data.subject)||!data.body)throw fail('메일 제목과 본문을 확인해 주세요.');
   const requested=b.attachments||(a.status==='review'?(a.snapshot.attachments||(a.document_id?[{id:a.document_id}]:[])):[]);
   if(!Array.isArray(requested)||requested.length<1||requested.length>5)throw fail('첨부파일 1~5개를 준비해 주세요.');
   const attachments=[];let total=0;
   for(const entry of requested){
    const f=await owned(env,'career_files',user.id,uuid(entry.id));
    if(!['resume','attachment'].includes(f.kind))throw fail('업로드한 지원서 파일을 사용해 주세요.');
    const name=textValue(entry.name||f.name,200);
    if(!name||/[\x00-\x1f\x7f/\\]/.test(name)||name.split('.').pop().toLowerCase()!==f.name.split('.').pop().toLowerCase())throw fail('파일명은 바꿀 수 있지만 확장자는 유지해 주세요.');
    total+=f.data_base64.length;
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(f.data_base64)))].map(n=>n.toString(16).padStart(2,'0')).join('');
    attachments.push({id:f.id,name,mime:f.mime,hash});
   }
   if(total>12000000||new Set(attachments.map(f=>f.id)).size!==attachments.length)throw fail('서로 다른 파일, 합계 9MB 이하로 첨부해 주세요.');
   data.document_id=attachments[0].id;
   data.recipient=recipient;data.status='queued';data.approved_at=now();data.reason=null;data.snapshot={...a.snapshot,rule_updated_at:rule.updated_at,sender_email:account.email,sender_connected_at:account.connected_at,allowed_recipients:[recipient],attachments,manual_edit:true,auto:false,requirements_reviewed:true};
  }else throw fail('지원 작업을 확인해 주세요.');
  const rows=await patch(env,'career_applications',`id=eq.${a.id}&user_id=eq.${uid}&version=eq.${a.version}&status=eq.${a.status}`,data);if(!rows.length)throw fail('지원 상태가 바뀌었습니다. 새로고침해 주세요.',409);return reply(rows[0]);
 }
 return reply({error:'지원하지 않는 요청입니다.'},404);
 }catch(e){
  for(const [key,msg,status] of [['resume_pair_missing','PDF와 Word(.docx) 파일을 각각 등록해 주세요.',400],['resume_archived','이력서는 교체 후에도 지원 이력으로 보관합니다.',409],['resume_conflict','다른 창에서 설정이 바뀌었습니다. 새로고침해 주세요.',409],['resume_file_limit','이력서는 20개까지 보관합니다. 사용하지 않는 파일을 삭제해 주세요.',400],['resume_in_use','지원 이력이나 현재 설정에서 사용하는 파일은 삭제할 수 없습니다.',409],['resume_missing','본인의 이력서 파일을 선택해 주세요.',400],['resume_consent','개인 메일 연결과 자동 발송 동의가 필요합니다.',400],['resume_invalid','이력서와 설정 값을 확인해 주세요.',400]])if(e.message.includes(key))throw fail(msg,status);
  throw e;
 }
}
