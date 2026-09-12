/* 비공개 작업공간. 사용자 입력은 textContent/value로 출력하고 분석 이벤트로 보내지 않는다. */
(async () => {
  'use strict';
  const $=id=>document.getElementById(id),A=window.cpAuth,screen=document.body.dataset.screen;
  const labels={full_name:'이름',phone:'연락처',address:'주소',education:'학력',career:'경력',certifications:'자격·어학',target_firm:'지원 법인',target_role:'지원 직무'};
  const fieldLabels={...labels,email:'연결한 메일 주소',essay:'최종 자소서'};
  let state,template,dirty=false,lastResults='',lastApps='',polling=false;
  function node(tag,text,cls) {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
  function message(text,error=false){$('message').textContent=text;$('message').className='status-message'+(error?' err':'');$('message').hidden=false;}
  async function api(path,method='GET',value) {
    const {data:{session}}=await A.client.auth.getSession();
    if(!session)throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    const r=await fetch('/api/career/'+path,{method,headers:{Authorization:'Bearer '+session.access_token,...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(value)}:{})});
    if(!r.ok){const x=await r.json().catch(()=>({}));throw new Error(x.error||'요청을 처리하지 못했습니다.');}
    return path.startsWith('files/')?r.blob():r.json();
  }
  function action(button,fn){button.addEventListener('click',async()=>{button.disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{button.disabled=false;}});}
  function button(text,fn,cls='btn'){const b=node('button',text,cls);b.type='button';action(b,fn);return b;}
  function download(id,name){return async()=>{const blob=await api('files/'+id);const url=URL.createObjectURL(blob);const a=node('a');a.href=url;a.download=name||'지원서';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);};}
  function option(value,text){const o=node('option',text);o.value=value;return o;}
  function inputField(key,label,value,multiline=false){
    const wrap=node('div',undefined,'field'),id='identity-'+key,l=node('label',label);l.htmlFor=id;
    const i=node(multiline?'textarea':'input');i.id=id;i.value=value||'';i.maxLength=multiline?5000:200;
    if(!multiline)i.type='text';wrap.append(l,i);return wrap;
  }
  function sheetData(section){
    const saved=state.profile.data.sheets?.[section.id];
    if(Array.isArray(saved)&&saved.length)return saved;
    return section.questions?section.questions.map(q=>[String(q.no),q.category,q.question,'','','','미작성']):[section.columns.map(()=> '')];
  }
  function renderSheets(){
    $('sheets').replaceChildren();
    for(const section of template.sections){
      const details=node('details',undefined,'card');details.open=section.id==='01';details.append(node('summary',section.title),node('p',section.description,'tip'),node('p',section.tip,'tip'));
      const list=node('div');list.dataset.section=section.id;
      function addRow(values){
        const row=node('div',undefined,'sheet-row');const grid=node('div',undefined,'grid');
        if(section.questions)row.append(node('h3',values[0]+'. '+values[2]),node('p',values[1],'tip'));
        section.columns.forEach((name,index)=>{
          if(section.questions&&index<3)return;
          const wrap=node('div',undefined,'field'),id=`sheet-${section.id}-${crypto.randomUUID()}-${index}`,l=node('label',name);l.htmlFor=id;
          const input=node(section.questions&&index===6?'select':'textarea');input.id=id;input.dataset.col=index;
          if(input.tagName==='SELECT')for(const x of ['미작성','작성 중','완료'])input.append(option(x,x));else input.maxLength=5000;
          input.value=values[index]||'';wrap.append(l,input);grid.append(wrap);
        });
        row.dataset.fixed=JSON.stringify(values.slice(0,3));row.append(grid);
        if(!section.questions)row.append(button('이 행 삭제',async()=>{row.remove();dirty=true;}));
        list.append(row);
      }
      sheetData(section).forEach(addRow);details.append(list);
      if(!section.questions)details.append(button('행 추가',async()=>{if(list.children.length>=30)throw new Error('각 시트는 30행까지 작성할 수 있습니다.');addRow(section.columns.map(()=>''));dirty=true;}));
      $('sheets').append(details);
    }
  }
  function collect(){
    const identity={};for(const key of Object.keys(labels))identity[key]=$('identity-'+key).value.trim();
    const sheets={};for(const section of template.sections){
      const list=document.querySelector(`[data-section="${section.id}"]`);sheets[section.id]=[...list.children].map(row=>{
        const values=section.columns.map(()=> '');if(section.questions)JSON.parse(row.dataset.fixed).forEach((v,i)=>values[i]=v);
        row.querySelectorAll('[data-col]').forEach(i=>values[Number(i.dataset.col)]=i.value.trim());return values;
      });
    }
    return {identity,sheets,essay:$('essay').value.trim(),ai_consent:$('ai-consent').checked,ai_consent_provider:state.ai_provider.toLowerCase(),facts_confirmed:$('facts-confirmed').checked};
  }
  async function save(){
    state.profile=await api('profile','PUT',{data:collect(),version:state.profile.version});dirty=false;
    $('save-state').textContent='저장 완료 · '+new Date(state.profile.updated_at).toLocaleString('ko-KR');
    message('작성 자료를 저장했습니다. 자동 발송을 사용했다면 조건 화면에서 다시 활성화해 주세요.');
  }
  function essayCount(){const t=$('essay').value;$('essay-count').textContent=`공백 포함 ${t.length.toLocaleString()}자 · 공백 제외 ${t.replace(/\s/g,'').length.toLocaleString()}자 · UTF-8 ${new TextEncoder().encode(t).length.toLocaleString()}바이트`;}
  async function job(kind,extra={}){
    if(screen==='essay')await save();
    await api('jobs','POST',{kind,...extra});message('작업을 요청했습니다. 몇 분 걸릴 수 있습니다. 결과는 이 화면에 표시됩니다.');await refresh();
  }
  function renderJobs(){
    if(screen==='essay'){
      const signature=JSON.stringify(state.jobs);if(signature===lastResults)return;lastResults=signature;
      $('ai-results').replaceChildren();$('exports').replaceChildren();
      for(const j of state.jobs){
        if(!['assist','essay','export'].includes(j.kind))continue;
        const area=j.kind==='export'?$('exports'):$('ai-results');const d=node('details',undefined,'card');
        d.append(node('summary',`${{assist:'재료 구체화',essay:'자소서 초안',export:'문서 생성'}[j.kind]} · ${{pending:'대기 중',running:'처리 중',done:'완료',failed:'실패'}[j.status]} · ${new Date(j.created_at).toLocaleString('ko-KR')}`));
        if(j.status==='failed')d.append(node('p',j.error,'tip'));
        if(j.result?.draft){
          d.append(node('p',j.result.draft,'result'));
          for(const [key,title] of [['questions','추가로 확인할 내용'],['warnings','검토할 내용'],['evidence','사용한 근거']])if(j.result[key]?.length)d.append(node('h3',title),node('p',j.result[key].join('\n'),'result'));
          if(j.result.rationale)d.append(node('p',j.result.rationale,'tip'));
          d.append(button('최종 자소서 편집칸에 가져오기',async()=>{if($('essay').value&&!confirm('편집칸의 현재 내용을 이 초안으로 바꿀까요? 저장한 자료는 저장 버튼을 누르기 전까지 유지됩니다.'))return;$('essay').value=j.result.draft;$('facts-confirmed').checked=false;dirty=true;essayCount();$('essay').focus();message('편집칸에 가져왔습니다. 사실 여부를 확인하고 수정한 뒤 저장해 주세요.');}));
        }
        if(j.result?.file_id)d.append(button(j.result.name+' 다운로드',download(j.result.file_id,j.result.name)));
        if(j.result?._meta)d.append(node('p',`${j.result._meta.provider} · ${j.result._meta.model} · ${j.result._meta.seconds}초`,'tip'));
        area.append(d);
      }
    }else renderInspection();
  }
  async function initEssay(){
    template=await fetch('/career-template.json').then(r=>r.json());
    for(const [key,label] of Object.entries(labels))$('identity').append(inputField(key,label,state.profile.data.identity?.[key],['education','career','certifications'].includes(key)));
    renderSheets();$('essay').value=state.profile.data.essay||'';$('ai-consent').checked=state.profile.data.ai_consent===true;$('facts-confirmed').checked=state.profile.data.facts_confirmed===true;$('ai-provider').textContent=state.ai_provider;essayCount();
    $('workspace').addEventListener('input',e=>{dirty=true;if(e.target!==$('facts-confirmed')&&e.target!==$('ai-consent'))$('facts-confirmed').checked=false;essayCount();});
    action($('save'),save);action($('assist'),()=>job('assist',{prompt:$('prompt').value,section:$('ai-section').value}));
    action($('generate'),()=>job('essay',{prompt:$('prompt').value,section:$('ai-section').value}));
    for(const format of ['docx','pdf'])action($('export-'+format),()=>job('export',{format}));
    action($('delete-workspace'),async()=>{if(!confirm('작성 자료·지원 이력·파일·메일 연결을 모두 삭제할까요? 복구할 수 없습니다.'))return;await api('workspace','DELETE');dirty=false;location.reload();});
    window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
  }
  function checks(id){return [...$(id).querySelectorAll('input:checked')].map(i=>i.value);}
  function setChecks(id,values=[]){$(id).querySelectorAll('input').forEach(i=>i.checked=values.includes(i.value));}
  function mailState(){
    $('mail-state').textContent=state.mail?`${state.mail.email} · ${state.mail.provider==='google'?'Gmail':'Microsoft'}`:'연결한 메일이 없습니다.';
    $('disconnect').hidden=!state.mail;
    for(const p of ['google','microsoft']){$('connect-'+p).disabled=!state.providers[p];$('connect-'+p).title=state.providers[p]?'':'서비스 연결 설정 준비 중';}
  }
  function templateList(){
    $('templates').replaceChildren();
    const selected=$('rule-template').value||state.rule?.template_id||'';
    $('rule-template').replaceChildren(option('','지정 양식은 매번 검수'));
    for(const f of state.templates)if(f.verified_at)$('rule-template').append(option(f.id,`${f.verified_company} · ${f.name}`));
    $('rule-template').value=selected;
    for(const f of state.templates){const d=node('div',undefined,'actions');d.append(node('span',f.name),button('항목 읽기',()=>job('inspect',{template_id:f.id})),button('원본 다운로드',download(f.id,f.name)));$('templates').append(d);}
  }
  let inspectionSignature='';
  function renderInspection(){
    const signature=JSON.stringify(state.jobs.filter(j=>j.kind==='inspect'));if(signature===inspectionSignature)return;inspectionSignature=signature;
    $('template-inspection').replaceChildren();
    const j=state.jobs.find(j=>j.kind==='inspect');if(!j)return;
    if(j.status!=='done'){$('template-inspection').append(node('p',j.error||'양식 항목을 읽는 중입니다.'));return;}
    const r=j.result,existing=state.templates.find(t=>t.id===r.template_id)?.mapping||{};
    $('template-inspection').append(node('p',r.help,'tip'));const map=node('div',undefined,'mapping');
    for(const f of r.fields){const l=node('label',f.label);l.htmlFor='mapping-'+f.id;const s=node('select');s.id=l.htmlFor;s.dataset.key=f.id;s.append(option('','채우지 않음'));for(const [key,label] of Object.entries(fieldLabels))s.append(option(key,label));s.value=existing[f.id]||f.field||'';map.append(l,s);}
    $('template-inspection').append(map,button('항목 연결 저장',async()=>{const mapping={};map.querySelectorAll('select').forEach(s=>{if(s.value)mapping[s.dataset.key]=s.value;});await api('templates/'+r.template_id,'PUT',{mapping});message('항목 연결을 저장했습니다. 지원함에서 양식을 선택해 다시 준비한 뒤 파일을 검수해 주세요.');await refresh();}));
  }
  function renderApps(){
    const signature=JSON.stringify(state.applications)+JSON.stringify(state.templates);if(signature===lastApps)return;
    if($('applications').contains(document.activeElement))return;lastApps=signature;
    const area=$('applications');area.replaceChildren();
    if(!state.applications.length){area.append(node('p','준비한 지원서가 없습니다. 공고를 고르거나 자동지원 조건을 저장해 주세요.','empty'));return;}
    const names={preparing:'준비 중',review:'검수 필요',queued:'발송 대기',sending:'발송 중',sent:'발송 접수',blocked:'보류',cancelled:'취소',delivery_unknown:'결과 불명',failed:'실패'};
    for(const a of state.applications){
      const card=node('article',undefined,'application');card.append(node('span',names[a.status],'pill'),node('h3',(a.snapshot?.company||'선택한 공고')+' · '+(a.snapshot?.title||'지원서 준비')));
      const original=node('a','공고 원문 보기 ↗');
      try{const u=new URL(a.snapshot?.detail_url);if(u.protocol==='https:'||u.protocol==='http:'){original.href=u.href;original.target='_blank';original.rel='noopener noreferrer';card.append(original);}}catch{}
      if(a.reason)card.append(node('p',a.reason,'result'));
      if(a.snapshot?.requirements){const q=a.snapshot.requirements;card.append(node('p','제출 서류: '+q.required_documents.join(', '),'tip'));
        if(q.subject_evidence)card.append(node('p','제목 규칙 원문: '+q.subject_evidence,'tip'));
      }
      if(a.recipient)card.append(node('p','받는 사람: '+a.recipient));
      const editable=a.status==='review';const title=node('input'),body=node('textarea');title.type='text';title.value=a.subject||'';title.maxLength=200;title.disabled=!editable;title.id='subject-'+a.id;
      body.value=a.body||'';body.maxLength=10000;body.disabled=!editable;body.id='body-'+a.id;
      if(a.subject||editable){const l=node('label','메일 제목');l.htmlFor=title.id;const l2=node('label','메일 내용');l2.htmlFor=body.id;card.append(l,title,l2,body);}
      if(a.document_id)card.append(button('첨부파일 다운로드·검수',download(a.document_id)));
      if(['review','blocked','failed'].includes(a.status)){
        const select=node('select');select.append(option('','자유양식 / 기존 선택 유지'));for(const f of state.templates)select.append(option(f.id,f.name));select.value=a.template_id||'';select.setAttribute('aria-label','지원 양식');card.append(select);
        card.append(button('이 양식으로 다시 준비',async()=>{await api('applications/'+a.id,'PUT',{action:'prepare',version:a.version,template_id:select.value||null});message('지원서를 다시 준비합니다.');lastApps='';await refresh();}));
      }
      if(editable){
        const check=node('label',undefined,'check'),input=node('input');input.type='checkbox';check.append(input,node('span','원문 요구사항·받는 사람·제목·본문·첨부파일을 모두 확인했습니다.'));card.append(check);
        card.append(button('내 메일로 보내기',async()=>{if(!input.checked)throw new Error('메일 내용과 첨부파일을 검수하고 확인을 체크해 주세요.');await api('applications/'+a.id,'PUT',{action:'approve',version:a.version,reviewed:true,subject:title.value,body:body.value});message('발송 대기에 등록했습니다.');lastApps='';await refresh();},'btn primary'));
      }
      if(['preparing','review','queued','blocked','failed'].includes(a.status))card.append(button('이 지원 취소',async()=>{await api('applications/'+a.id,'PUT',{action:'cancel',version:a.version});message('지원 준비·발송 대기를 취소했습니다.');lastApps='';await refresh();}));
      area.append(card);
    }
  }
  async function initApply(){
    mailState();
    for(const p of ['google','microsoft'])action($('connect-'+p),async()=>{const data=await api('mail-connect','POST',{provider:p});location.assign(data.url);});
    action($('disconnect'),async()=>{await api('mail','DELETE');message('메일 연결을 해제하고 자동지원을 중지했습니다.');await refresh();$('rule-enabled').checked=false;});
    const {data:firms,error:firmError}=await A.client.from('firms').select('id,name').order('name').limit(1000);
    if(firmError)throw new Error('법인 목록을 불러오지 못했습니다. 새로고침해 주세요.');
    for(const f of firms)$('firm-filter').append(option(String(f.id),f.name));
    const {data:posts,error:postError}=await A.client.from('job_postings').select('id,title,company_name,ij_id').eq('is_expired',false).is('removed_at',null).order('posted_at',{ascending:false}).limit(500);
    if(postError)throw new Error('공고 목록을 불러오지 못했습니다. 새로고침해 주세요.');
    $('posting-picker').append(option('','지원할 공고를 선택하세요'));
    for(const p of posts)$('posting-picker').append(option(String(p.id),`${p.company_name||''} · ${p.title}`));
    const query=new URLSearchParams(location.search),from=query.get('posting');
    if(from){const p=posts.find(p=>p.ij_id===from);if(p)$('posting-picker').value=String(p.id);}
    const rule=state.rule,f=rule?.filters||{};
    if(rule){$('rule-enabled').checked=rule.enabled;$('rule-mode').value=rule.mode;$('daily-limit').value=rule.daily_limit;}
    $('all-firms').checked=f.all_firms===true;
    for(const o of $('firm-filter').options)o.selected=(f.firms||[]).includes(o.value);
    for(const key of ['regions','types','employment'])setChecks(key,f[key]);
    for(const [id,key] of [['revenue-min','revenue_min'],['revenue-max','revenue_max'],['experience-years','experience_years']])$(id).value=f[key]??'';
    $('keywords').value=(f.keywords||[]).join(', ');$('exclude').value=(f.exclude||[]).join(', ');
    action($('save-rule'),async()=>{
      if($('rule-enabled').checked&&$('rule-mode').value==='auto'&&!$('auto-consent').checked)throw new Error('자동 발송에 동의해 주세요.');
      const filters={firms:[...$('firm-filter').selectedOptions].map(o=>o.value),all_firms:$('all-firms').checked};
      for(const key of ['regions','types','employment'])filters[key]=checks(key);
      for(const [id,key] of [['revenue-min','revenue_min'],['revenue-max','revenue_max'],['experience-years','experience_years']])filters[key]=$(id).value===''?null:Number($(id).value);
      for(const key of ['keywords','exclude'])filters[key]=$(key).value.split(',').map(s=>s.trim()).filter(Boolean);
      await api('rules','PUT',{template_id:$('rule-template').value||null,enabled:$('rule-enabled').checked,mode:$('rule-mode').value,daily_limit:Number($('daily-limit').value),filters,consent_version:$('auto-consent').checked?'auto-v1':null});message('조건을 저장했습니다. 지금 이후 새로 발견한 공고부터 적용합니다.');await refresh();
    });
    action($('prepare-posting'),async()=>{if(!$('posting-picker').value)throw new Error('공고를 선택해 주세요.');await api('applications','POST',{posting_id:$('posting-picker').value});message('지원서 준비를 요청했습니다.');await refresh();});
    action($('upload-template'),async()=>{const file=$('template-file').files[0];if(!file||file.size>3000000)throw new Error('3MB 이하의 양식 파일을 선택해 주세요.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));await api('templates','POST',{name:file.name,data_base64:btoa(binary)});message('양식을 등록했습니다. 항목 읽기로 정보를 연결해 주세요.');await refresh();});
    action($('refresh'),async()=>{lastApps='';await refresh();message('최신 상태를 불러왔습니다.');});
    templateList();
    if(query.get('mail')==='connected')message('개인 메일을 연결했습니다. 자동지원 조건과 검수함을 확인해 주세요.');
    if(query.get('mail')==='cancelled')message('메일 연결을 취소했습니다.');
    if(query.get('mail')==='missing_send_permission')message('메일 발송 권한을 받지 못했습니다. 개인 메일을 다시 연결하고 이메일 전송 권한을 허용해 주세요.',true);
    if(query.get('mail')==='missing_refresh_token')message('메일 발송 권한은 확인했지만 연결을 유지할 인증 정보를 받지 못했습니다. 개인 메일 연결을 다시 시도해 주세요.',true);
  }
  async function refresh(){
    if(polling)return;polling=true;
    try{const updated=await api('state');if(screen==='essay'&&updated.ai_provider!==state.ai_provider){$('ai-consent').checked=false;$('ai-provider').textContent=updated.ai_provider;message('AI 공급자가 변경되었습니다. 처리 범위를 확인하고 다시 동의해 주세요.');}state={...updated,profile:screen==='essay'?state.profile:updated.profile};renderJobs();if(screen==='apply'){mailState();templateList();renderApps();}}
    finally{polling=false;}
  }
  try{
    const me=await A.ensure('complete');if(me.state!=='complete')return;
    state=await api('state');
    if(screen==='essay')await initEssay();else await initApply();
    $('workspace').hidden=false;$('message').hidden=true;renderJobs();if(screen==='apply')renderApps();
    if(screen==='essay'&&state.jobs_enabled===false){for(const id of ['assist','generate','export-docx','export-pdf']){const b=$(id);if(b)b.disabled=true;}message('작성 자료와 자소서는 저장할 수 있습니다. AI 도움과 문서 생성은 준비 중입니다.');}
    setInterval(()=>{if(!document.hidden)refresh().catch(e=>message('상태 갱신 실패: '+e.message,true));},8000);
  }catch(e){message(e.message,true);}
})();
