(() => {
 const menu=document.getElementById('account-menu'),link=document.getElementById('auth-link'),label=document.getElementById('account-nickname');if(!menu||!link)return;
 let sequence=0,lastToken=null;
 async function update(force=false){let token=null;try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^sb-.*-auth-token$/.test(k)){const v=JSON.parse(localStorage.getItem(k)||'null');if(v?.access_token)token=v.access_token;}}}catch{}
 menu.hidden=!token;link.hidden=!!token;document.documentElement.classList.toggle('member',!!token);
 if(!token){sequence++;lastToken=null;if(label)label.textContent='내 계정';return;}if(token===lastToken&&!force)return;const seq=++sequence;lastToken=token;if(label)label.textContent='내 계정';
 try{const r=await fetch('/api/me/nickname',{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(r.ok){const p=await r.json();if(seq===sequence&&label)label.textContent=p.nickname||'내 계정';}}catch{}
 }
 update();addEventListener('storage',()=>update());addEventListener('pageshow',()=>update(true));addEventListener('cpaping:profile-updated',()=>update(true));
 if(window.cpAuth?.client)window.cpAuth.client.auth.onAuthStateChange(()=>{setTimeout(()=>update(),0);});
 document.addEventListener('click',e=>{if(!menu.contains(e.target))menu.open=false;});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
})();
