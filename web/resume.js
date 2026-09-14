(async()=>{
'use strict';const $=id=>document.getElementById(id),A=window.cpAuth;let state={files:[],applications:[]},dirty=false,loading=false,busy=false,ready=false,formVersion=null;
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
const message=(s,error=false)=>{const el=$('resume-message');if(el){el.textContent=s;el.className='status-message'+(error?' err':'');}if($('save-feedback')){$('save-feedback').textContent=s;$('save-feedback').dataset.error=String(error);}};
const text=(id,value)=>{if($(id))$(id).textContent=value;};
const date=value=>{const d=new Date(value);return value&&!Number.isNaN(d.getTime())?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(d):'';};
function lock(value){busy=value;if($('resume-editor'))$('resume-editor').disabled=value||!ready;if($('resume-enabled'))$('resume-enabled').disabled=value||!ready;if($('save-resume-rule'))$('save-resume-rule').disabled=value||!ready;if($('stop-resume'))$('stop-resume').disabled=value;}
function savedSummary(){const r=state.rule;text('resume-rule-state',r?.enabled?'새 공고 지원 켜짐':'새 공고 지원 꺼짐');text('summary-mode',r?.enabled?(r.mode==='auto'?'자동발송 · 제출 요건 확인 후 발송':'수동발송 · 검수 후 보내기'):'설정을 켜고 저장하면 시작합니다.');text('summary-file',state.files.find(f=>f.id===r?.resume_file_id)?.name||'저장된 이력서 없음');text('saved-at',r?.updated_at?'마지막 저장 · '+date(r.updated_at)+' (한국시간)':'아직 저장한 설정이 없습니다.');if($('stop-resume'))$('stop-resume').hidden=!r?.enabled;}
function changed(){dirty=true;message('변경한 내용은 아직 저장되지 않았습니다.');}

async function api(path,method='GET',body){const {data:{session}}=await A.client.auth.getSession();if(!session)throw new Error('다시 로그인해 주세요.');const r=await fetch('/api/career/'+path,{method,headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){const b=await r.json().catch(()=>({}));throw new Error(b.error||'요청을 처리하지 못했습니다.');}return path.startsWith('files/')?r.blob():r.json();}
async function download(id,name){const blob=await api('files/'+id),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name||'이력서';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function button(text,fn){const b=node('button',text);b.className='btn';b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{b.disabled=false;}};return b;}
function option(value,text){const o=node('option',text);o.value=value;return o;}
function queue(){const list=$('resume-applications');if(!list)return;list.replaceChildren();
 for(const a of state.applications){const card=node('details');card.className='resume-application';card.id='application-'+a.id;if(new URLSearchParams(location.search).get('review')===a.id)card.open=true;const status={preparing:'준비 중',review:'검수 필요',queued:'발송 대기',sending:'발송 중',blocked:'보류',failed:'실패',delivery_unknown:'결과 불명'}[a.status]||a.status;
 card.append(node('summary',(a.snapshot.company||'선택한 공고')+' · '+status));if(a.snapshot.title)card.append(node('p',a.snapshot.title));if(a.reason)card.append(node('p',a.reason));
 if(a.origin==='rule'&&a.status==='review'){const notice=Array.isArray(a.career_review_notices)?a.career_review_notices[0]:a.career_review_notices;card.append(node('p','검수 안내 메일: '+({sent:'가입한 이메일로 발송했습니다.',pending:'발송 대기 중입니다.',sending:'발송 접수 확인 중입니다.',failed:'발송하지 못했습니다. 이 화면에서 직접 검수할 수 있습니다.',unknown:'발송 결과를 확인하지 못했습니다. 이 화면에서 직접 검수할 수 있습니다.',cancelled:'안내 발송이 중지되었습니다.'}[notice?.status]||'다음 작업에서 안내를 준비합니다.')));}
 if(a.snapshot.detail_url){try{const u=new URL(a.snapshot.detail_url);if(u.protocol==='https:'&&['www.kicpa.or.kr','kicpa.or.kr'].includes(u.hostname)){const link=node('a','공고 원문 확인 ↗');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}}catch{}}
 if(a.document_id){const f=state.files.find(f=>f.id===a.document_id);card.append(button('첨부 이력서 확인',()=>download(a.document_id,f?.name)));}
 const update=async payload=>{await api('resume-applications/'+a.id,'PUT',{version:a.version,...payload});await load();message('지원 상태를 변경했습니다.');};
 if(a.status==='review'&&a.document_id){
  const recipient=node('select');for(const email of a.snapshot.allowed_recipients||[])recipient.append(option(email,email));if(a.recipient)recipient.value=a.recipient;
  const subject=node('input');subject.value=a.subject||'';subject.maxLength=200;const body=node('textarea');body.value=a.body||'';body.rows=6;body.maxLength=10000;
  for(const [label,control] of [['받는 사람',recipient],['메일 제목',subject],['메일 본문',body]]){const l=node('label',label);l.className='field';l.append(control);card.append(l);}
  const reviewed=node('input');reviewed.type='checkbox';const l=node('label','공고의 제출 요건·수신자·문구와 첨부 이력서를 모두 확인했습니다. 추가 서류나 지정 양식이 있다면 이 파일이 해당 요건을 충족하는지도 확인했습니다.');l.prepend(reviewed);card.append(l);
  card.append(button('검수 완료 · 보내기',async()=>{if(!reviewed.checked)throw new Error('공고 원문과 첨부파일을 먼저 확인해 주세요.');await update({action:'approve',reviewed:true,recipient:recipient.value,subject:subject.value,body:body.value});}));
 }
 if(['review','blocked','failed'].includes(a.status))card.append(button('현재 이력서로 다시 준비',()=>update({action:'prepare'})));
 if(['review','blocked','failed','queued','preparing'].includes(a.status))card.append(button('지원 취소',()=>update({action:'cancel'})));
 list.append(card);
 }
 if(!state.applications.length)list.append(node('p','준비 중이거나 검수할 지원이 없습니다.'));
 if(state.applications.length>=state.limit)list.append(node('p','최근 '+state.limit+'건을 표시하고 있습니다. 완료·취소한 항목은 이 목록에서 제외됩니다.'));
}
function files(){if(!$('resume-selected'))return;const selected=$('resume-selected'),current=selected.value;selected.replaceChildren(option('','이력서를 선택하세요'));$('resume-files').replaceChildren();
 for(const f of state.files){selected.append(option(f.id,f.name));const row=node('div');row.className='resume-file-row';const info=node('div');info.className='resume-file-info';info.append(node('strong',f.name));if(f.created_at){const meta=node('span',date(f.created_at)+' 업로드');meta.className='small-copy';info.append(meta);}const actions=node('div');actions.className='resume-file-actions';actions.append(button('다운로드',()=>download(f.id,f.name)),button('삭제',async()=>{if(busy)return;lock(true);try{await api('resumes/'+f.id,'DELETE');await load(false);files();details();message('파일을 삭제했습니다.');}finally{lock(false);}}));row.append(info,actions);$('resume-files').append(row);}
 if(!state.files.length)$('resume-files').append(node('p','아직 업로드한 이력서가 없습니다.'));selected.value=state.files.some(f=>f.id===current)?current:'';text('file-count',state.files.length);
}
function details(){dispatchEvent(new CustomEvent('cpaping:resume-loaded',{detail:{files:state.files,rule:state.rule}}));}
function form(){if(!$('resume-form'))return;files();const r=state.rule,f=r?.filters||{};formVersion=r?.updated_at||null;
 $('resume-selected').value=r?.resume_file_id||state.files[0]?.id||'';$('applicant-name').value=r?.applicant_name||'';
 if(r?.mail_subject_template)$('resume-subject').value=r.mail_subject_template;if(r?.mail_body_template)$('resume-body').value=r.mail_body_template;
 const employment=Array.isArray(f.employment)&&f.employment.length?f.employment:['Full Time','Part Time'];$('resume-full').checked=employment.includes('Full Time');$('resume-part').checked=employment.includes('Part Time');
 $('resume-mode').value=r?.mode||'review';$('resume-limit').value=r?.daily_limit||5;$('resume-enabled').checked=r?.enabled===true;$('resume-consent').checked=false;$('resume-confirmed').checked=false;
 dirty=false;savedSummary();details();
}
async function load(reset=true){if(loading)await loading.catch(()=>{});const task=(async()=>{state=await api('resume-state');if(reset)form();else savedSummary();queue();})();loading=task;try{await task;}finally{if(loading===task)loading=false;}}
try{
 const auth=await A.ensure('needs_profile');if(!['complete','needs_profile'].includes(auth.state))return;
 if($('resume-form')){
 async function mailState(){text('mail-badge','확인 중');$('refresh-mail')&&($('refresh-mail').disabled=true);try{const r=await api('state');text('mail-state',r.mail?'연결된 계정: '+r.mail.email:'연결한 계정이 없습니다. Gmail을 연결해 주세요.');text('summary-mail',r.mail?.email||'연결 필요');text('mail-badge',r.mail?'연결됨':'미연결');if($('mail-badge'))$('mail-badge').dataset.state=r.mail?'connected':'disconnected';$('connect').hidden=!!r.mail;$('disconnect').hidden=!r.mail;dispatchEvent(new CustomEvent('cpaping:mail-loaded',{detail:r.mail||null}));}catch(e){text('mail-state','연결 상태를 확인하지 못했습니다. 상태 새로고침으로 다시 확인해 주세요.');text('summary-mail','확인 필요');text('mail-badge','확인 실패');if($('mail-badge'))$('mail-badge').dataset.state='error';$('connect').hidden=false;dispatchEvent(new CustomEvent('cpaping:mail-loaded',{detail:null}));throw e;}finally{if($('refresh-mail'))$('refresh-mail').disabled=false;}}
 $('connect').onclick=async()=>{const b=$('connect');b.disabled=true;try{const r=await api('mail-connect','POST',{provider:'google'}),u=new URL(r.url);if(u.origin!=='https://accounts.google.com')throw new Error('연결 주소를 확인해 주세요.');location.assign(u.href);}catch(e){message(e.message,true);}finally{b.disabled=false;}};
 $('disconnect').onclick=async()=>{if(busy)return;$('disconnect').disabled=true;lock(true);try{await api('mail','DELETE');await load(false);formVersion=state.rule?.updated_at||null;$('resume-enabled').checked=false;details();await mailState();message('메일 연결을 해제하고 새 공고 지원을 중지했습니다.');}catch(e){message(e.message,true);}finally{lock(false);$('disconnect').disabled=false;}};
 if($('refresh-mail'))$('refresh-mail').onclick=()=>mailState().catch(e=>message(e.message,true));
 const result=new URLSearchParams(location.search).get('mail');if(result)history.replaceState(null,'',location.pathname);
 mailState().catch(()=>{});
 async function initialise(){lock(true);try{await load();ready=true;lock(false);if($('retry-resume'))$('retry-resume').hidden=true;message(result?(result==='connected'?'개인 Gmail을 연결했습니다. 이력서와 지원 설정을 확인해 주세요.':'Gmail 연결을 완료하지 못했습니다. 다시 연결해 주세요.'):(state.rule?'저장된 설정을 불러왔습니다. 수정한 내용은 저장 후 적용됩니다.':'Gmail을 연결하고 이력서를 올려 첫 지원을 준비해 보세요.'),!!result&&result!=='connected');}catch(e){ready=false;lock(false);text('resume-rule-state','설정 확인 필요');text('summary-file','확인 필요');message('설정을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.',true);if($('retry-resume'))$('retry-resume').hidden=false;}}
 if($('retry-resume'))$('retry-resume').onclick=initialise;
 $('resume-form').addEventListener('input',changed);
 $('resume-form').addEventListener('invalid',()=>message('필수 입력과 이력서 확인 항목을 확인해 주세요.',true),true);
 if($('download-current'))$('download-current').onclick=async()=>{const f=state.files.find(f=>f.id===$('resume-selected').value);if(!f)return;const b=$('download-current');b.disabled=true;try{await download(f.id,f.name);}catch(e){message(e.message,true);}finally{b.disabled=false;}};
 $('upload-resume').onclick=async()=>{if(busy||!ready)return;const b=$('upload-resume');lock(true);b.disabled=true;b.textContent='업로드 중…';let uploaded=false;try{const f=window.cpResumeFile||$('resume-upload').files[0];if(!f||f.size>3000000||! /\.(pdf|docx)$/i.test(f.name))throw new Error('3MB 이하 PDF 또는 Word(.docx)를 선택해 주세요.');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(new Error('파일을 읽지 못했습니다.'));r.readAsDataURL(f);});const saved=await api('resumes','POST',{name:f.name,data_base64:data});uploaded=true;await load(false);files();$('resume-selected').value=saved.id;formVersion=state.rule?.updated_at||null;$('resume-enabled').checked=false;$('resume-confirmed').checked=false;$('resume-consent').checked=false;dirty=true;$('resume-upload').value='';window.cpResumeFile=null;details();dispatchEvent(new Event('cpaping:resume-uploaded'));message('업로드했습니다. 파일을 확인하고 새 공고 지원을 켜서 저장해 주세요.');}catch(e){if(uploaded){ready=false;$('resume-enabled').checked=false;if($('retry-resume'))$('retry-resume').hidden=false;message('파일은 업로드되었지만 최신 설정을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.',true);}else message(e.message,true);}finally{lock(false);b.disabled=!window.cpResumeFile;b.textContent='선택한 파일 업로드';}};
 $('resume-form').onsubmit=async e=>{e.preventDefault();if(busy||!ready)return;const b=$('save-resume-rule');lock(true);b.textContent='저장 중…';let committed=false;try{const filters={employment:[$('resume-full').checked?'Full Time':null,$('resume-part').checked?'Part Time':null].filter(Boolean)};
 if(!filters.employment.length){if($('employment-error'))$('employment-error').hidden=false;throw new Error('풀타임 또는 파트타임을 하나 이상 선택해 주세요.');}
 if($('resume-mode').value==='auto'&&$('resume-enabled').checked&&!$('resume-consent').checked)throw new Error('별도 승인 없이 자동 발송하는 것에 동의해 주세요.');
 await api('resume-rule','PUT',{resume_file_id:$('resume-selected').value,applicant_name:$('applicant-name').value,subject:$('resume-subject').value,body:$('resume-body').value,filters,mode:$('resume-mode').value,enabled:$('resume-enabled').checked,daily_limit:Number($('resume-limit').value),updated_at:formVersion,file_confirmed:$('resume-confirmed').checked,auto_consent:$('resume-consent').checked});committed=true;await load();message(state.rule?.enabled?'저장했습니다. 지금 이후의 새 공고부터 선택한 방식으로 지원합니다.':'새 공고 지원이 꺼진 상태로 설정을 저장했습니다.');}catch(e){if(committed){ready=false;if($('retry-resume'))$('retry-resume').hidden=false;message('저장은 완료했지만 최신 설정을 확인하지 못했습니다. 다시 불러오기를 눌러 주세요.',true);}else message(e.message,true);}finally{lock(false);b.textContent='설정 저장하기 →';}};
 $('stop-resume').onclick=async()=>{if(busy)return;lock(true);try{await api('resume-stop','POST',{});await load(false);formVersion=state.rule?.updated_at||null;$('resume-enabled').checked=false;details();message('새 공고 지원을 중지했습니다. 발송 대기는 검수 상태로 변경했습니다.');}catch(e){message(e.message,true);}finally{lock(false);}};
 await initialise();
 }else{await load();message('준비된 지원서를 확인하고 발송을 승인하세요.');}
 if($('refresh-resume'))$('refresh-resume').onclick=()=>load().catch(e=>message(e.message,true));$('refresh')?.addEventListener('click',()=>load().catch(e=>message(e.message,true)));
 const pid=new URLSearchParams(location.search).get('posting');if($('selected-posting')&&pid&&/^\d{1,15}$/.test(pid)){const {data:p}=await A.client.from('job_postings').select('id,title,company_name').eq('id',pid).maybeSingle();if(p){$('selected-posting').hidden=false;$('selected-posting-title').textContent=p.company_name+' · '+p.title;$('prepare-selected').onclick=async()=>{const b=$('prepare-selected');b.disabled=true;try{await api('resume-applications','POST',{posting_id:p.id});await load();message('지원 준비를 요청했습니다. 다음 작업 실행 후 검수할 수 있습니다.');}catch(e){message(e.message,true);}finally{b.disabled=false;}};}}
 setInterval(()=>{if(!document.hidden&&!dirty&&!busy&&(!$('resume-form')||ready)&&!document.querySelector('.resume-application[open]'))load(false).catch(()=>{});},15000);
}catch(e){message(e.message,true);}
})();
