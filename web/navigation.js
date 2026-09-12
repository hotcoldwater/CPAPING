(() => {
  const menu=document.getElementById('account-menu'),link=document.getElementById('auth-link');if(!menu||!link)return;
  function update(){let signed=false;try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^sb-.*-auth-token$/.test(k)){const v=JSON.parse(localStorage.getItem(k)||'null');if(v?.access_token)signed=true;}}}catch{}menu.hidden=!signed;link.hidden=signed;document.documentElement.classList.toggle('member',signed);}
  update();addEventListener('storage',update);addEventListener('pageshow',update);
  if(window.cpAuth?.client)window.cpAuth.client.auth.onAuthStateChange(()=>update());
  document.addEventListener('click',e=>{if(!menu.contains(e.target))menu.open=false;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
})();
