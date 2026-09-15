/* A single mounted form keeps uploads and draft fields intact between screens. */
(()=>{
 const form=document.getElementById('resume-form');if(!form)return;
 const $=id=>document.getElementById(id),viewport=$('resume-step-viewport');
 const labels=['이력서','지원 조건','메일 작성','Gmail 연결','발송 방식','최종 확인'];
 const steps=[...form.querySelectorAll('[data-resume-step]')];
 const review=document.createElement('section');review.className='setup-section';review.dataset.resumeStep='';review.setAttribute('aria-labelledby','review-heading');
 review.innerHTML='<div class="section-heading"><span class="step" aria-hidden="true">6</span><h2 id="review-heading">마지막으로 확인해 주세요</h2></div><div class="surface draft-review"><h3>저장할 설정</h3><dl id="resume-draft-summary"></dl><p class="small-copy"><span id="review-save-help">저장하면 선택한 방식으로 자동 지원을 시작합니다.</span></p></div>';
 viewport.append(review);steps.push(review);
 review.append(form.querySelector('.file-confirm'));

 const nav=form.querySelector('.resume-step-navigation');nav.append($('save-resume-rule'));
 const progress=form.querySelector('.resume-progress');let current=0;
 const buttons=labels.map((label,index)=>{const b=document.createElement('button');b.type='button';b.innerHTML='<span class="progress-number">'+(index+1)+'</span><span>'+label+'</span>';b.addEventListener('click',()=>go(index));progress.append(b);return b;});
 function summary(){
  const entries=[['이력서',$('preview-file').textContent||'업로드 필요'],['지원자',$('applicant-name').value||'입력 필요'],['지원 조건',[$('resume-full').checked?'풀타임':'',$('resume-part').checked?'파트타임':''].filter(Boolean).join(' · ')||'선택 필요'],['발송 방식',$('resume-mode').value==='auto'?'바로 발송':'검수 후 발송'],['메일 제목',$('resume-subject').value],['일일 발송 한도','제한 없음']];
  const dl=$('resume-draft-summary');dl.replaceChildren();for(const [key,value] of entries){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;row.append(dt,dd);dl.append(row);}
 }
 function show(index,focus=true){
  if($('resume-message').classList.contains('err')){$('resume-message').classList.remove('err');$('resume-message').textContent='입력한 내용은 마지막 단계에서 저장됩니다.';}
  current=index;steps.forEach((step,i)=>step.hidden=i!==index);buttons.forEach((b,i)=>{if(i===index)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');b.dataset.complete=String(i<index);});
  $('resume-previous').disabled=index===0;$('resume-next').hidden=index===steps.length-1;$('save-resume-rule').hidden=index!==steps.length-1;
  $('resume-step-count').textContent=(index+1)+' / '+steps.length;form.dataset.step=String(index+1);summary();dispatchEvent(new Event('cpaping:step-changed'));viewport.scrollTop=0;
  if(focus){const h=steps[index].querySelector('h2');h.tabIndex=-1;h.focus({preventScroll:true});}
 }
 function error(index,control,text){show(index);const m=$('resume-message');m.hidden=false;m.textContent=text;m.classList.add('err');control?.focus();control?.reportValidity();return false;}
 function validate(index){
  if(index===0&&(window.cpResumeUploadState==='error'||window.cpResumeUploadState==='uploading'))return error(index,$('resume-upload'),'새 파일 업로드를 완료하거나 기존 파일 유지를 선택해 주세요.');
  if(index===0&&!$('resume-file-id').value)return error(index,$('resume-upload'),'이력서 파일을 업로드해 주세요.');
  if(index===1&&!$('resume-full').checked&&!$('resume-part').checked){$('employment-error').hidden=false;return error(index,$('resume-full'),'풀타임 또는 파트타임을 하나 이상 선택해 주세요.');}
  if(index===1)$('employment-error').hidden=true;
  if(index===3&&window.cpResumeWillEnable&&!window.cpResumeMail)return error(index,$('connect'),'지원 메일을 보낼 Gmail을 연결해 주세요.');
  for(const control of steps[index].querySelectorAll('input[required],select[required],textarea[required]')){
   if(!control.checkValidity())return error(index,control,index===0?'지원할 이력서를 업로드해 주세요.':'필수 입력 항목을 확인해 주세요.');
  }
  return true;
 }
 function go(index){if(index<current){show(index);return;}if($('resume-editor').disabled&&index>current)return;for(let i=0;i<index;i++)if(!validate(i))return;show(index);}
 $('resume-next').addEventListener('click',()=>go(current+1));$('resume-previous').addEventListener('click',()=>show(Math.max(0,current-1)));
 form.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&['text','email'].includes(e.target.type)){e.preventDefault();if(current<steps.length-1)go(current+1);}});
 // A browser's implicit submit must never save an unfinished screen.
 window.cpResumeSteps={show,get current(){return current;},prepareSubmit(){if(current!==steps.length-1){go(current+1);return false;}for(let i=0;i<steps.length;i++)if(!validate(i))return false;
  if(window.cpResumeWillEnable&&$('resume-mode').value==='auto'&&!$('resume-consent').checked)return error(4,$('resume-consent'),'별도 승인 없이 자동 발송하는 것에 동의해 주세요.');return true;}};
 form.addEventListener('input',()=>{if(current===5)summary();});
 window.addEventListener('cpaping:resume-loaded',summary);
 new MutationObserver(()=>{$('resume-next').disabled=$('resume-editor').disabled;}).observe($('resume-editor'),{attributes:true,attributeFilter:['disabled']});
 $('resume-next').disabled=$('resume-editor').disabled;form.classList.add('step-form');show(0,false);
})();
