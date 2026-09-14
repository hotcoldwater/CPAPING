(() => {
 const menu=document.getElementById('account-menu'),link=document.getElementById('auth-link'),label=document.getElementById('account-nickname');if(!menu||!link)return;
 let sequence=0,retries=0,shownUser=null;
 function stored(){try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^sb-.*-auth-token$/.test(k)){const v=JSON.parse(localStorage.getItem(k)||'null');if(v?.access_token)return v;}}}catch{}return null;}
 function visible(signed){menu.hidden=!signed;link.hidden=signed;document.documentElement.classList.toggle('member',signed);}
 const script=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.append(s);});
 async function refresh(){
  if(!window.cpAuth){window.cpAuthReady||=(async()=>{if(!window.supabase)await script('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js');if(!window.cpAuth)await script('/auth.js');})();await window.cpAuthReady;}
  const {data,error}=await window.cpAuth.client.auth.refreshSession();if(error||!data.session)throw new Error('session');return data.session;
 }
 async function update(){const seq=++sequence;let session=stored();if(!session){visible(false);shownUser=null;if(label)label.textContent='닉네임 설정';return;}visible(true);
  const owner=session.user?.id||session.access_token;if(shownUser!==owner&&label)label.textContent='닉네임 확인 중…';
  try{
   if(window.cpAuth){const {data}=await window.cpAuth.client.auth.getSession();session=data.session;if(!session){if(seq===sequence)visible(false);return;}}
   let r=await fetch('/api/me/nickname',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
   if(r.status===401){session=await refresh();r=await fetch('/api/me/nickname',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});}
   if(!r.ok)throw new Error('nickname');const p=await r.json();if(seq!==sequence)return;
   if(label)label.textContent=p.nickname||'닉네임 설정';shownUser=session.user?.id||session.access_token;retries=0;
  }catch{if(seq!==sequence)return;if(!shownUser&&label)label.textContent='닉네임 다시 확인';if(retries++<2)setTimeout(update,3000);}
 }
 update();addEventListener('storage',()=>update());addEventListener('pageshow',()=>update());addEventListener('cpaping:profile-updated',()=>update());
 if(window.cpAuth?.client)window.cpAuth.client.auth.onAuthStateChange(()=>{setTimeout(update,0);});
 menu.addEventListener('toggle',()=>{if(menu.open)update();});
 document.addEventListener('click',e=>{if(!menu.contains(e.target))menu.open=false;});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
})();
