(()=>{
 const $=id=>document.getElementById(id),zone=$('resume-drop');if(!zone)return;
 function pick(files){if(files.length!==1){$('resume-chosen').textContent='파일을 한 개만 선택해 주세요.';window.cpResumeFile=null;return;}const f=files[0];if(f.size>3000000||! /\.(pdf|docx)$/i.test(f.name)){$('resume-chosen').textContent='3MB 이하 PDF 또는 Word(.docx)를 선택해 주세요.';window.cpResumeFile=null;$('resume-upload').value='';return;}window.cpResumeFile=f;$('resume-chosen').textContent=f.name+' · '+(f.size/1000000).toFixed(2)+' MB';}
 $('resume-upload').addEventListener('change',e=>pick(e.target.files));
 for(const event of ['dragenter','dragover'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.add('dragging');});
 zone.addEventListener('dragleave',()=>zone.classList.remove('dragging'));zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragging');$('resume-upload').value='';pick(e.dataTransfer.files);});
 addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault();});addEventListener('drop',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault();});
 addEventListener('cpaping:resume-uploaded',()=>{$('resume-chosen').textContent='선택한 파일 없음';});
 function preview(){const values={'[회계법인]':'예시회계법인','{법인}':'예시회계법인','{이름}':$('applicant-name').value||'지원자 이름','{공고}':'신입 회계사 채용'};const fill=v=>v.replace(/\[회계법인\]|\{(?:법인|이름|공고)\}/g,k=>values[k]);$('preview-subject').textContent=fill($('resume-subject').value);$('preview-body').textContent=fill($('resume-body').value);}
 $('resume-form').addEventListener('input',preview);addEventListener('cpaping:resume-loaded',preview);preview();
})();
