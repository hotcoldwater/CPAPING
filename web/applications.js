(async()=>{
'use strict';
const $=id=>document.getElementById(id),A=window.cpAuth;
const names={review:'검수필요',blocked:'확인필요',sent:'지원완료',passed:'서류합격',final_passed:'최종합격',rejected:'불합격'};
const busyNames={preparing:'지원 정보를 준비하고 있습니다.',queued:'발송을 기다리고 있습니다.',sending:'메일을 발송하고 있습니다.'};
let items=[],offset=0,hasMore=false,loading=false,generation=0,selected=null,detailGeneration=0;
const node=(tag,value,cls)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(cls)n.className=cls;return n;};
const date=(v,short=false)=>v?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',...(short?{}:{timeStyle:'short'})}).format(new Date(v)):'—';
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const statusOf=item=>item.display_status||item.manual_status||(item.outcome_source==='manual'&&['passed','rejected'].includes(item.outcome)?item.outcome:item.status==='sent'?'sent':['blocked','failed','delivery_unknown','cancelled'].includes(item.status)?'blocked':'review');
const editable=item=>item.application_id&&['review','blocked','failed','delivery_unknown'].includes(item.status)&&['review','blocked'].includes(statusOf(item));
function message(value,error=false){$('message').textContent=value;$('message').classList.toggle('err',error);}
async function api(path,method='GET',body){const {data:{session}}=await A.client.auth.getSession();if(!session)throw new Error('다시 로그인해 주세요.');const r=await fetch('/api/career/'+path,{method,headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){const b=await r.json().catch(()=>({}));throw new Error(b.error||'요청을 처리하지 못했습니다.');}return path.startsWith('files/')?r.blob():r.json();}
function button(label,fn,cls='btn'){const b=node('button',label,cls);b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){$('detail-message').textContent=e.message;}finally{b.disabled=false;}};return b;}
function badge(label,kind){return node('span',label,'history-badge '+kind);}
function render(){const tbody=$('deliveries');tbody.replaceChildren();for(const item of items){
 const row=node('tr'),company=node('td'),link=button(item.company||'지원 공고',()=>openDetail(item),'posting-link');link.setAttribute('aria-label',(item.company||'지원')+' 지원 상세');company.append(link,node('span',item.title||item.subject||'','posting-title'));row.append(company,node('td',item.region||'—'),node('td',date(item.posted_at,true),'history-date'),node('td',date(item.site_applied_on||item.sent_at,true),'history-date'));
 const read=node('td');read.append(badge(item.first_open_at?'읽음':'안읽음',item.first_open_at?'read':'unread'));row.append(read);
 const state=node('td'),value=statusOf(item),label=names[value];
 if(item.application_id){const change=button(label,()=>openStatus(item),'history-badge status-control '+value);change.setAttribute('aria-label',(item.company||'지원')+' 상태 변경: '+label);change.disabled=!!busyNames[item.status];state.append(change);}else state.append(badge(label,value));
 if(busyNames[item.status])state.append(node('small',item.status==='preparing'?'준비 중':item.status==='queued'?'발송 대기 중':'발송 중'));
 row.append(state);const action=node('td');if(editable(item)){const edit=button('수정',()=>openDetail(item));edit.setAttribute('aria-label',(item.company||'지원')+' 수정');action.append(edit);}row.append(action);tbody.append(row);
 }
 $('history-empty').hidden=items.length>0;$('history-empty').textContent=$('status').value!=='all'||$('search').value?'조건에 맞는 지원 내역이 없습니다.':'아직 지원 내역이 없습니다.';$('more').hidden=!hasMore;
}
async function load(reset=true){const request=++generation;loading=true;$('refresh').disabled=true;$('more').disabled=true;try{const q=new URLSearchParams({offset:String(reset?0:offset),status:$('status').value,search:$('search').value.trim()});const result=await api('application-history?'+q);if(request!==generation)return;items=reset?result.items:[...items,...result.items];offset=items.length;hasMore=result.has_more;render();message('지원 내역 '+items.length+'건'+(hasMore?' · 더 보기로 이전 내역을 확인하세요.':''));}finally{if(request===generation){loading=false;$('refresh').disabled=false;$('more').disabled=false;}}}
function field(label,control){const l=node('label',label,'field');l.append(control);return l;}
function dialog(item){selected=item;++detailGeneration;const target=$('application-detail');target.replaceChildren();$('detail-message').textContent='';$('application-detail-title').textContent=item.company||'지원 상세';if(!$('application-dialog').open)$('application-dialog').showModal();return target;}
async function freshItem(id){return items.find(x=>x.id===id)||(await api('application-history?id='+encodeURIComponent(id))).items[0];}
async function refreshSelected(id){await load();const current=await freshItem(id);if(current)await openDetail(current);}
function safeLink(target,label,url){if(!/^https:\/\//.test(url||''))return;const link=node('a',label,'btn');link.href=url;link.target='_blank';link.rel='noopener noreferrer';target.append(link);}
function openStatus(item){const target=dialog(item);$('application-detail-title').textContent=(item.company||'지원')+' · 상태 변경';
 target.append(node('p',item.title||''));const choice=node('select');choice.id='application-status';for(const [value,label] of Object.entries(names)){const option=node('option',label);option.value=value;choice.append(option);}choice.value=statusOf(item);target.append(field('지원 상태',choice));
 const website=item.snapshot?.analysis?.method==='website',applied=node('input');applied.type='date';applied.max=today();applied.value=item.site_applied_on||'';
 if(website)target.append(field('사이트에 지원한 날짜',applied));
 target.append(node('p','전화·문자 등으로 받은 결과를 직접 기록하세요. 상태를 변경해도 메일이 발송되지는 않습니다.','tip'),button('저장',async()=>{
  if(website&&['sent','passed','final_passed','rejected'].includes(choice.value)&&!applied.value)throw new Error('사이트에 지원한 날짜를 입력해 주세요.');
  await api('resume-applications/'+item.application_id+'/status','PUT',{version:item.version,status:choice.value,applied_on:website?(applied.value||null):null});$('application-dialog').close();await load();message('지원 상태를 저장했습니다.');
 }));
}
async function openDetail(item){const target=dialog(item),request=detailGeneration;target.append(node('h3',item.title||item.subject||'지원 공고'));
 const analysis=item.snapshot?.analysis,website=analysis?.method==='website';
 if(item.posting_id){const link=node('a','공고 확인 ↗');link.href=item.snapshot?.posting_ij_id?'/posting/'+item.snapshot.posting_ij_id+'/':'/';link.target='_blank';link.rel='noopener noreferrer';target.append(link);}
 if(website){target.append(node('p','사이트에서 직접 지원한 뒤 지원완료로 변경하고 지원일을 입력해 주세요.','detail-reason'));safeLink(target,'지원 사이트로 이동 ↗',analysis.apply_url||item.snapshot?.detail_url);}
 if(item.reason)target.append(node('p',item.reason,'detail-reason'));
 if(item.snapshot?.test_recipient)target.append(node('p','테스트 계정: 지원 메일은 '+item.snapshot.test_recipient+'으로만 발송됩니다.','tip'));
 if(busyNames[item.status]){target.append(node('p',busyNames[item.status]+' 완료되면 이 화면이 갱신됩니다.','detail-reason'));return;}
 const canEdit=editable(item)&&!website,blank=canEdit&&statusOf(item)==='blocked';
 const files=blank?[]:(item.snapshot?.attachments||item.attachments||[]).map(f=>({...f}));if(!blank&&!files.length&&item.document_id)files.push({id:item.document_id,name:item.document_name});
 async function download(f){const blob=await api('files/'+f.id),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=f.name||'지원서';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 if(canEdit){
  const recipient=node('input'),subject=node('input'),body=node('textarea');recipient.type='email';recipient.value=item.recipient||'';subject.value=item.subject||'';subject.maxLength=200;body.value=item.body||'';body.maxLength=10000;body.rows=8;target.append(field('받는 사람',recipient),field('메일 제목',subject),field('메일 본문',body));
  const fileList=node('div',undefined,'manual-attachments');target.append(node('h3','첨부파일'),node('p',blank?'공고에 맞는 지원서류를 업로드해 주세요.':'첨부파일을 확인하고 필요하면 삭제하거나 추가해 주세요.','tip'),fileList);
  function renderFiles(){fileList.replaceChildren();if(!files.length)fileList.append(node('p','첨부된 파일이 없습니다.','tip'));for(const [index,f] of files.entries()){const row=node('div',undefined,'attachment-row'),name=node('input');name.value=f.name||'';name.maxLength=200;name.oninput=()=>{f.name=name.value;};row.append(field('파일명',name),button('다운로드',()=>download(f)),button('삭제',async()=>{files.splice(index,1);renderFiles();}));fileList.append(row);}}
  renderFiles();const upload=node('input');upload.type='file';upload.multiple=true;upload.accept='.pdf,.docx,.doc,.hwp,.hwpx,.xls,.xlsx,.png,.jpg,.jpeg';target.append(field('파일 추가 · 파일당 3MB, 최대 5개·합계 9MB',upload));let uploading=false;
  upload.onchange=async()=>{if(!upload.files.length||uploading)return;uploading=true;upload.disabled=true;try{const additions=[...upload.files];if(files.length+additions.length>5||additions.some(f=>f.size>3000000))throw new Error('파일당 3MB, 최대 5개까지 첨부할 수 있습니다.');for(const f of additions){const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('파일을 읽지 못했습니다.'));reader.readAsDataURL(f);});const saved=await api('resume-attachments','POST',{name:f.name,data_base64:encoded});if(request!==detailGeneration)return;files.push({id:saved.id,name:f.name});renderFiles();}$('detail-message').textContent='첨부파일을 추가했습니다.';}catch(e){if(request===detailGeneration)$('detail-message').textContent=e.message;}finally{uploading=false;upload.disabled=false;upload.value='';}};
  const checked=node('input');checked.type='checkbox';if(item.status==='delivery_unknown'){const label=node('label',undefined,'check');label.append(checked,node('span','보낸편지함을 확인했으며, 이 지원 메일이 발송되지 않았습니다.'));target.append(label);}
  target.append(node('p','제목·본문·받는 사람과 첨부파일을 확인한 뒤 발송해 주세요.','tip'),button('발송',async()=>{
   if(uploading)throw new Error('첨부파일 업로드를 기다려 주세요.');if(!files.length)throw new Error('첨부파일을 추가해 주세요.');if(item.status==='delivery_unknown'&&!checked.checked)throw new Error('보낸편지함에서 발송되지 않았는지 먼저 확인해 주세요.');
   await api('resume-applications/'+item.application_id,'PUT',{version:item.version,action:'approve',reviewed:true,delivery_checked:checked.checked,recipient:recipient.value,subject:subject.value,body:body.value,attachments:files.map(f=>({id:f.id,name:f.name}))});await refreshSelected(item.id);
  },'btn send-application'));
 }else if(!website){
  target.append(node('h3',item.sent_at?'보낸 메일':'메일 내용'),node('strong',item.subject||'—'),node('pre',item.body||'—','delivery-body'));for(const f of files)target.append(button('첨부파일 · '+f.name,()=>download(f)));
  if(item.sent_at)target.append(node('p','발송일: '+date(item.sent_at),'tip'));
 }
 if(website&&item.application_id)target.append(button('지원 상태·지원일 입력',()=>openStatus(item)));
}
try{
 const auth=await A.ensure('needs_profile');if(!['complete','needs_profile'].includes(auth.state))return;
 $('close-detail').onclick=()=>$('application-dialog').close();$('application-dialog').addEventListener('close',()=>{selected=null;detailGeneration++;});
 $('refresh').onclick=()=>load().catch(e=>message(e.message,true));$('more').onclick=()=>load(false).catch(e=>message(e.message,true));$('history-filter-form').onsubmit=e=>{e.preventDefault();load().catch(e=>message(e.message,true));};$('status').onchange=()=>load().catch(e=>message(e.message,true));
 await load();const query=new URLSearchParams(location.search),review=query.get('review'),posting=query.get('posting');
 if(review&&/^[\da-f-]{36}$/i.test(review)){const item=await freshItem(review);if(item)await openDetail(item);else message('해당 지원 내역을 찾을 수 없습니다.',true);}
 if(posting&&/^\d{1,15}$/.test(posting)){const app=await api('resume-applications','POST',{posting_id:posting});history.replaceState(null,'',location.pathname);await refreshSelected(app.id);}
 setInterval(async()=>{if(document.hidden||loading)return;try{if(!$('application-dialog').open&&offset<=25)await load();else if(selected&&busyNames[selected.status]){const id=selected.id,request=detailGeneration,result=await api('application-history?id='+encodeURIComponent(id));if(request===detailGeneration&&result.items[0]&&(result.items[0].status!==selected.status||result.items[0].version!==selected.version))await openDetail(result.items[0]);}}catch{}},5000);
}catch(e){message(e.message,true);}
})();
