(async()=>{
'use strict';const $=id=>document.getElementById(id),A=window.cpAuth;
let items=[],offset=0,hasMore=false,loading=false,generation=0,selected=null,detailGeneration=0;
const statusNames={preparing:'준비 중',review:'검수 필요',queued:'발송 대기',sending:'발송 중',sent:'발송 완료',blocked:'보류',failed:'발송 실패',delivery_unknown:'발송 결과 불명',cancelled:'취소'};
const resultNames={pending:'결과 대기',received:'접수 확인',needs_review:'답장 확인 필요',passed:'서류합격',rejected:'서류불합격'};
const modeNames={auto:'바로 발송',review:'검수 후 발송',test:'테스트'};
const node=(tag,value,cls)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(cls)n.className=cls;return n;};
const date=(v,short=false)=>v?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',...(short?{}:{timeStyle:'short'})}).format(new Date(v)):'—';
function message(value,error=false){$('message').textContent=value;$('message').classList.toggle('err',error);}
async function api(path,method='GET',body){const {data:{session}}=await A.client.auth.getSession();if(!session)throw new Error('다시 로그인해 주세요.');const r=await fetch('/api/career/'+path,{method,headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){const b=await r.json().catch(()=>({}));throw new Error(b.error||'요청을 처리하지 못했습니다.');}return path.startsWith('files/')?r.blob():r.json();}
function button(label,fn){const b=node('button',label,'btn');b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){$('detail-message').textContent=e.message;}finally{b.disabled=false;}};return b;}
function badge(label,kind){return node('span',label,'history-badge '+kind);}
function render(){const tbody=$('deliveries');tbody.replaceChildren();for(const item of items){const row=node('tr'),company=node('td');company.append(node('strong',item.company||'지원 공고'),node('span',item.title||item.subject||'', 'posting-title'));row.append(company);
 const when=node('td',date(item.sent_at,true),'history-date');if(!item.sent_at)when.append(node('small','준비 '+date(item.created_at,true)));row.append(when,node('td',modeNames[item.mode]||'—'));
 const status=node('td');status.append(badge(statusNames[item.status]||item.status,item.status));row.append(status,node('td',item.first_open_at?'읽음 추정':item.sent_at?'확인 안 됨':'—'));
 const result=node('td');result.append(badge(resultNames[item.outcome]||'결과 대기',item.outcome||'pending'));if(item.outcome_source&&item.outcome_source!=='none')result.append(node('small',item.outcome_source==='mail'?'메일 자동 확인':'직접 기록'));row.append(result);
 const detail=node('td');const label=item.status==='review'?'검수하기':['blocked','failed','delivery_unknown'].includes(item.status)?'사유 확인':'상세 보기';const b=button(label,()=>openDetail(item));b.setAttribute('aria-label',(item.company||'지원')+' '+label);detail.append(b);row.append(detail);tbody.append(row);}
 $('history-empty').hidden=items.length>0;$('history-empty').textContent=[$('status').value,$('mode').value,$('result').value].some(v=>v!=='all')||$('search').value?'조건에 맞는 지원 내역이 없습니다.':'아직 지원 내역이 없습니다.';$('more').hidden=!hasMore;
}
async function load(reset=true){const request=++generation;loading=true;$('refresh').disabled=true;$('more').disabled=true;try{const q=new URLSearchParams({offset:String(reset?0:offset),status:$('status').value,mode:$('mode').value,result:$('result').value,search:$('search').value.trim()});const result=await api('application-history?'+q);if(request!==generation)return;items=reset?result.items:[...items,...result.items];offset=items.length;hasMore=result.has_more;render();message('지원 내역 '+items.length+'건'+(hasMore?' · 더 보기로 이전 내역을 확인하세요.':''));}finally{if(request===generation){loading=false;$('refresh').disabled=false;$('more').disabled=false;}}}
function field(label,control){const l=node('label',label,'field');l.append(control);return l;}
function select(options,value){const s=node('select');for(const [v,label] of options){const o=node('option',label);o.value=v;s.append(o);}s.value=value;return s;}
function addMeta(target,pairs){const dl=node('dl',undefined,'detail-meta');for(const [k,v] of pairs){dl.append(node('dt',k),node('dd',v||'—'));}target.append(dl);}
async function refreshSelected(id){await load();const current=items.find(x=>x.id===id)||(await api('application-history?id='+encodeURIComponent(id))).items[0];if(current)await openDetail(current);}
async function openDetail(item){selected=item;const request=++detailGeneration,target=$('application-detail');target.replaceChildren();$('detail-message').textContent='';$('application-detail-title').textContent=item.company||'지원 상세';if(!$('application-dialog').open)$('application-dialog').showModal();
 target.append(node('h3',item.title||item.subject));addMeta(target,[['진행 상태',statusNames[item.status]],['서류 결과',resultNames[item.outcome]||'결과 대기'],['발송 시각',date(item.sent_at)],['첫 열람 신호',date(item.first_open_at)],['받는 사람',item.recipient]]);
 if(item.posting_id){const link=node('a','공고 확인 ↗');link.href='/posting/'+item.posting_id+'/';link.target='_blank';link.rel='noopener noreferrer';target.append(link);}
 if(item.reason)target.append(node('p',item.reason,'detail-reason'));
 if(item.document_id)target.append(button('첨부 이력서 · '+(item.document_name||'다운로드'),async()=>{const blob=await api('files/'+item.document_id),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=item.document_name||'이력서';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
 const update=async payload=>{await api('resume-applications/'+item.application_id,'PUT',{version:item.version,...payload});await refreshSelected(item.id);};
 if(item.status==='review'&&item.document_id&&item.application_id){
 const recipient=select((item.snapshot?.allowed_recipients||[]).map(v=>[v,v]),item.recipient),subject=node('input'),body=node('textarea');subject.value=item.subject||'';subject.maxLength=200;body.value=item.body||'';body.maxLength=10000;body.rows=7;target.append(field('받는 사람',recipient),field('메일 제목',subject),field('메일 본문',body));
 const check=node('input');check.type='checkbox';const label=node('label',undefined,'check');label.append(check,node('span','공고 원문·수신자·메일·첨부 이력서를 확인했으며 지정 양식이나 추가 서류 등 제출 요건을 충족합니다.'));target.append(label,button('검수 완료 · 보내기',async()=>{if(!check.checked)throw new Error('제출 요건과 첨부파일을 먼저 확인해 주세요.');await update({action:'approve',reviewed:true,recipient:recipient.value,subject:subject.value,body:body.value});}));
 }else{target.append(node('h3','보낸 메일'),node('strong',item.subject||'작성 전'),node('pre',item.body||'준비가 완료되면 메일 내용이 표시됩니다.','delivery-body'));}
 if(item.application_id&&['review','blocked','failed'].includes(item.status))target.append(button('현재 이력서로 다시 준비',()=>update({action:'prepare'})));
 if(item.application_id&&['review','blocked','failed','queued','preparing'].includes(item.status))target.append(button('지원 취소',()=>update({action:'cancel'})));
 if(item.delivery_id&&['sent','delivery_unknown'].includes(item.delivery_status||item.status)){
 target.append(node('h3','서류 결과'));const choice=select(Object.entries(resultNames),item.outcome||'pending');target.append(field('결과 직접 기록 · 전화/문자 결과 또는 자동 확인 정정',choice),button('결과 저장',async()=>{await api('deliveries/'+item.delivery_id+'/result','PUT',{result:choice.value,version:item.outcome_version||0});await refreshSelected(item.id);}));
 target.append(node('p','직접 기록한 결과는 이후 답장이 도착해도 자동으로 덮어쓰지 않습니다.','tip'));const events=node('section');events.append(node('h3','답장과 결과 기록'));target.append(events);
 try{const result=await api('deliveries/'+item.delivery_id+'/events');if(request!==detailGeneration)return;if(!result.items.length)events.append(node('p','아직 연결된 답장이나 직접 기록한 결과가 없습니다.','tip'));for(const event of result.items){const box=node('div',undefined,'reply-evidence');box.append(node('strong',resultNames[event.result]+' · '+(event.source==='mail'?'메일 자동 확인':'직접 기록')),node('small',date(event.received_at)));if(event.source==='mail'){box.append(node('p',(event.sender||'')+' · '+(event.subject||'')),node('pre',event.excerpt||'본문 확인 필요'));}events.append(box);}}catch(e){if(request===detailGeneration)events.append(node('p','답장 기록을 불러오지 못했습니다. 상세 보기를 다시 열어 주세요.','err'));}
 }
}
try{const auth=await A.ensure('needs_profile');if(!['complete','needs_profile'].includes(auth.state))return;
 $('close-detail').onclick=()=>$('application-dialog').close();$('application-dialog').addEventListener('close',()=>{selected=null;detailGeneration++;});
 $('refresh').onclick=()=>load().catch(e=>message(e.message,true));$('more').onclick=()=>load(false).catch(e=>message(e.message,true));$('history-filter-form').onsubmit=e=>{e.preventDefault();load().catch(e=>message(e.message,true));};for(const id of ['status','mode','result'])$(id).onchange=()=>load().catch(e=>message(e.message,true));
 await load();const query=new URLSearchParams(location.search),review=query.get('review'),posting=query.get('posting');
 if(review&&/^[\da-f-]{36}$/i.test(review)){const result=await api('application-history?id='+encodeURIComponent(review));if(result.items[0])await openDetail(result.items[0]);else message('해당 지원 내역을 찾을 수 없습니다.',true);}
 if(posting&&/^\d{1,15}$/.test(posting)){const {data:p,error}=await A.client.from('job_postings').select('id,title,company_name').eq('id',posting).maybeSingle();if(error)throw new Error('공고를 불러오지 못했습니다.');if(p){$('application-detail-title').textContent=p.company_name;const target=$('application-detail');target.replaceChildren(node('h3',p.title),node('p','등록된 이력서로 이 공고의 지원서를 준비합니다. 준비 후 내용을 확인하고 발송할 수 있습니다.'),button('이 공고에 지원 준비',async()=>{const app=await api('resume-applications','POST',{posting_id:p.id});history.replaceState(null,'',location.pathname);await refreshSelected(app.id);}));$('application-dialog').showModal();}}
 setInterval(()=>{if(!document.hidden&&!loading&&!$('application-dialog').open&&offset<=25)load().catch(()=>{});},15000);
}catch(e){message(e.message,true);}
})();
