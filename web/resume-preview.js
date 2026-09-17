(()=>{
 const $=id=>document.getElementById(id),zone=$('resume-drop');if(!zone)return;
 let files=[],savedFile=null,mail=null,lastEditor=$('resume-body');
 const text=(id,value)=>{if($(id))$(id).textContent=value;};
 function pick(list){if($('resume-editor').disabled)return;window.cpResumeFile=null;let error='';if(list.length!==1)error='파일을 한 개만 선택해 주세요.';else if(list[0].size>3000000||! /\.(pdf|docx)$/i.test(list[0].name))error='3MB 이하 PDF 또는 Word(.docx)를 선택해 주세요.';if(error){window.cpResumeUploadState='error';text('resume-chosen',error);$('resume-chosen').dataset.error='true';$('resume-upload').value='';$('retry-upload').hidden=true;$('keep-resume').hidden=!$('resume-file-id').value;return;}window.cpResumeFile=list[0];dispatchEvent(new Event('cpaping:resume-picked'));}
 $('resume-upload').addEventListener('change',e=>{if(e.target.files.length)pick(e.target.files);});
 $('replace-resume')?.addEventListener('click',()=>$('resume-upload').click());
 for(const event of ['dragenter','dragover'])zone.addEventListener(event,e=>{e.preventDefault();if(!$('resume-editor')?.disabled)zone.classList.add('dragging');});
 zone.addEventListener('dragleave',()=>zone.classList.remove('dragging'));zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragging');if($('resume-editor')?.disabled)return;$('resume-upload').value='';pick(e.dataTransfer.files);});
 addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault();});addEventListener('drop',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault();});
 addEventListener('cpaping:resume-uploaded',preview);
 function selectedFile(){const pair=[['PDF','resume-file-id'],['Word','resume-docx-file-id']].map(([label,id])=>label+': '+(files.find(f=>f.id===$(id)?.value)?.name||'업로드 필요'));text('resume-file-pair',pair.join('\n'));const f=files.find(f=>f.id===$('resume-file-id').value);text('preview-file',pair.join(' · '));if(!['uploading','error'].includes(window.cpResumeUploadState))text('resume-chosen',pair.every(x=>!x.endsWith('업로드 필요'))?'PDF와 Word 업로드가 완료되었습니다. 다음 단계로 진행해 주세요.':'PDF와 Word를 하나씩 올려 주세요. 같은 형식의 파일은 새 파일로 교체됩니다.');}
 function preview(){const values={'[회계법인]':'예시회계법인','{법인}':'예시회계법인','{이름}':$('applicant-name').value||'지원자 이름','{공고}':'신입 회계사 채용'};const fill=v=>v.replace(/\[회계법인\]|\{(?:법인|이름|공고)\}/g,k=>values[k]);text('preview-subject',fill($('resume-subject').value));text('preview-body',fill($('resume-body').value));text('preview-sender',mail?($('applicant-name').value?$('applicant-name').value+' · ':'')+mail.email:'Gmail을 연결해 주세요');selectedFile();
 const mode=$('resume-mode').value;for(const input of document.querySelectorAll('[name=send-mode]'))input.checked=input.value===mode;if($('auto-consent-panel'))$('auto-consent-panel').hidden=mode!=='auto';if($('employment-error')&&($('resume-full').checked||$('resume-part').checked))$('employment-error').hidden=true;
 }
 $('resume-form').addEventListener('input',e=>{if(e.target.name==='send-mode'){$('resume-mode').value=e.target.value;$('resume-consent').checked=false;}if(e.target.id==='resume-file-id'){$('resume-confirmed').checked=false;$('resume-consent').checked=false;}preview();});
 $('resume-file-id').addEventListener('change',()=>{$('resume-confirmed').checked=false;$('resume-consent').checked=false;preview();});
 for(const el of [$('resume-subject'),$('resume-body')])el.addEventListener('focus',()=>{lastEditor=el;});
 for(const button of document.querySelectorAll('[data-token]'))button.addEventListener('click',()=>{const el=lastEditor,token=button.dataset.token,start=el.selectionStart??el.value.length,end=el.selectionEnd??start;if(el.value.length-(end-start)+token.length>el.maxLength){text('resume-message','입력 가능한 글자 수를 초과했습니다.');return;}el.setRangeText(token,start,end,'end');el.focus();el.dispatchEvent(new Event('input',{bubbles:true}));});
 addEventListener('cpaping:resume-loaded',e=>{if(e.detail){files=e.detail.files||[];savedFile=e.detail.rule?.resume_file_id;}preview();});
 addEventListener('cpaping:mail-loaded',e=>{mail=e.detail;preview();});preview();
})();
