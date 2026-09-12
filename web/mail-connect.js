(async () => {
  'use strict';
  const $=id=>document.getElementById(id),A=window.cpAuth;
  function message(text,error=false){$('message').textContent=text;$('message').className='status-message'+(error?' err':'');}
  async function api(path,method='GET',body){
    const {data:{session}}=await A.client.auth.getSession();
    if(!session)throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
    const r=await fetch('/api/career/'+path,{method,headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||'연결 상태를 확인하지 못했습니다.');
    return data;
  }
  async function refresh(){
    const s=await api('state');
    $('workspace').hidden=false;
    $('mail-state').textContent=s.mail?'연결된 계정: '+s.mail.email:'아직 연결된 Gmail 계정이 없습니다.';
    $('connect-google').hidden=!!s.mail;
    $('connect-google').disabled=!s.providers?.google;
    $('disconnect').hidden=!s.mail;
    return s;
  }
  function action(id,fn){$(id).addEventListener('click',async()=>{
    $(id).disabled=true;
    try{await fn();}catch(e){message(e.message,true);}finally{$(id).disabled=false;}
  });}
  try{
    if(!A)throw new Error('로그인 화면을 불러오지 못했습니다. 새로고침해 주세요.');
    const auth=await A.ensure('complete');if(auth.state!=='complete')return;
    const state=await refresh();
    const result=new URLSearchParams(location.search).get('mail');
    const errors={
      missing_send_permission:'Google에서 메일 발송 권한을 받지 못했습니다. Gmail 연결을 다시 누르고, Google 동의 화면에서 이메일 전송 권한을 허용해 주세요. 해당 항목에 체크박스가 있으면 선택한 뒤 계속을 누르세요.',
      missing_refresh_token:'메일 발송 권한은 확인했지만 연결을 유지할 인증 정보를 Google에서 받지 못했습니다. Gmail 연결을 다시 시도해 주세요. 반복되면 아래 Google 연결된 앱에서 메일 발송용 CPAPING 연결을 삭제한 뒤 다시 연결해 주세요.'
    };
    if(errors[result])message(errors[result],true);
    else message(result==='cancelled'?'Google 계정 연결을 취소했습니다.':state.mail?'Gmail 연결을 확인했습니다. 메일은 발송되지 않았습니다.':'Gmail 연결 버튼을 눌러 시작하세요.');
    if(result)history.replaceState(null,'',location.pathname);
    action('connect-google',async()=>{const r=await api('mail-connect','POST',{provider:'google'});const u=new URL(r.url);if(u.origin!=='https://accounts.google.com')throw new Error('Google 연결 주소를 확인하지 못했습니다.');location.assign(u.href);});
    action('disconnect',async()=>{await api('mail','DELETE');await refresh();message('Gmail 연결을 해제했습니다.');});
    action('refresh',async()=>{const s=await refresh();message(s.mail?'Gmail 연결을 확인했습니다.':'아직 연결된 Gmail 계정이 없습니다.');});
  }catch(e){message(e.message,true);}
})();
