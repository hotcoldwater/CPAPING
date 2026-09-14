/* A single mounted form keeps uploads and draft fields intact between screens. */
(()=>{
 const form=document.getElementById('resume-form');if(!form)return;
 const $=id=>document.getElementById(id),viewport=$('resume-step-viewport');
 const labels=['메일 연결','이력서','메일 작성','지원 조건','발송 방식','최종 확인'];
 const steps=[...form.querySelectorAll('[data-resume-step]')];
 const review=document.createElement('section');review.className='setup-section';review.dataset.resumeStep='';review.setAttribute('aria-labelledby','review-heading');
 review.innerHTML='<div class="section-heading"><span class="step" aria-hidden="true">F</span><h2 id="review-heading">마지막으로 확인해 주세요</h2></div><div class="surface draft-review"><h3>저장할 설정</h3><dl id="resume-draft-summary"></dl><p class="small-copy">아래에서 새 공고 지원을 켠 뒤 저장하면 지원이 시작됩니다.</p></div>';
 viewport.append(review);steps.push(review);
 review.append(form.querySelector('.file-confirm'),form.querySelector('.save-bar'));
 const overview=form.querySelector('.resume-overview');const saved=document.createElement('details');saved.className='saved-settings';saved.innerHTML='<summary>현재 저장된 설정 보기</summary>';saved.append(overview);review.append(saved);
 const nav=form.querySelector('.resume-step-navigation');nav.append($('save-resume-rule'));
 const progress=form.querySelector('.resume-progress');let current=0;
 const buttons=labels.map((label,index)=>{const b=document.createElement('button');b.type='button';b.innerHTML='<span class="progress-number">'+(index+1)+'</span><span>'+label+'</span>';b.addEventListener('click',()=>go(index));progress.append(b);return b;});
 function summary(){
  const select=$('resume-selected');const entries=[['이력서',select.selectedOptions[0]?.textContent||'선택 필요'],['지원자',$('applicant-name').value||'입력 필요'],['지원 조건',[$('resume-full').checked?'풀타임':'',$('resume-part').checked?'파트타임':''].filter(Boolean).join(' · ')||'선택 필요'],['발송 방식',$('resume-mode').value==='auto'?'자동발송':'수동발송'],['메일 제목',$('resume-subject').value],['일일 발송 한도','제한 없음']];
  const dl=$('resume-draft-summary');dl.replaceChildren();for(const [key,value] of entries){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;row.append(dt,dd);dl.append(row);}
 }
 function show(index,focus=true){
  if($('resume-message').classList.contains('err')){$('resume-message').classList.remove('err');$('resume-message').textContent='입력한 내용은 마지막 단계에서 저장됩니다.';}
  current=index;steps.forEach((step,i)=>step.hidden=i!==index);buttons.forEach((b,i)=>{if(i===index)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');b.dataset.complete=String(i<index);});
  $('resume-previous').disabled=index===0;$('resume-next').hidden=index===steps.length-1;$('save-resume-rule').hidden=index!==steps.length-1;
  $('resume-step-count').textContent=(index+1)+' / '+steps.length;form.dataset.step=String(index+1);summary();viewport.scrollTop=0;
  if(focus){const h=steps[index].querySelector('h2');h.tabIndex=-1;h.focus({preventScroll:true});}
 }
 function error(index,control,text){show(index);const m=$('resume-message');m.textContent=text;m.classList.add('err');control?.focus();control?.reportValidity();return false;}
 function validate(index){
  if(index===3&&!$('resume-full').checked&&!$('resume-part').checked){$('employment-error').hidden=false;return error(index,$('resume-full'),'풀타임 또는 파트타임을 하나 이상 선택해 주세요.');}
  if(index===3)$('employment-error').hidden=true;
  for(const control of steps[index].querySelectorAll('input[required],select[required],textarea[required]')){
   if(!control.checkValidity())return error(index,control,index===1?'지원할 이력서를 업로드하고 선택해 주세요.':'필수 입력 항목을 확인해 주세요.');
  }
  return true;
 }
 function go(index){if(index<current){show(index);return;}if($('resume-editor').disabled&&index>current)return;for(let i=0;i<index;i++)if(!validate(i))return;show(index);}
 $('resume-next').addEventListener('click',()=>go(current+1));$('resume-previous').addEventListener('click',()=>show(Math.max(0,current-1)));
 form.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&['text','email'].includes(e.target.type)){e.preventDefault();if(current<steps.length-1)go(current+1);}});
 // A browser's implicit submit must never save an unfinished screen.
 window.cpResumeSteps={prepareSubmit(){if(current!==steps.length-1){go(current+1);return false;}for(let i=0;i<steps.length;i++)if(!validate(i))return false;
  if($('resume-enabled').checked&&$('resume-mode').value==='auto'&&!$('resume-consent').checked)return error(4,$('resume-consent'),'별도 승인 없이 자동 발송하는 것에 동의해 주세요.');return true;}};
 form.addEventListener('input',()=>{if(current===5)summary();});
 window.addEventListener('cpaping:resume-loaded',summary);
 new MutationObserver(()=>{$('resume-next').disabled=$('resume-editor').disabled;}).observe($('resume-editor'),{attributes:true,attributeFilter:['disabled']});
 $('resume-next').disabled=$('resume-editor').disabled;form.classList.add('step-form');show(0,false);
})();
