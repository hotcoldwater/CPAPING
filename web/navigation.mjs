import assetVersions from './asset-versions.mjs';
import {versionAssets} from './version-assets.mjs';
export function navigation(page,path='/',versions=assetVersions) {
  page=theme(page,path);
  if(!/<header\b[^>]*class="[^"]*\btopbar\b/.test(page))return versionAssets(page,versions);
  const active=path.startsWith('/firm')?'/firms/':path.startsWith('/board')?'/board/':path==='/'||path.startsWith('/posting')?'/':null;
  const tabs=[['/','공고'],['/firms/','법인'],['/board/','게시판']].map(([href,label])=>`<a href="${href}"${href===active?' aria-current="page"':''}>${label}</a>`).join('');
  const originalHeader=page.match(/<header\b[^>]*class="[^"]*\btopbar\b[^\"]*"[^>]*>[\s\S]*?<\/header>/)?.[0]||'';
  const status=originalHeader.match(/<div class="status">[\s\S]*?<\/div>/)?.[0]||'';
  const header=`<header class="topbar site-topbar"><a class="wordmark" href="/">CPAPING<span class="brand-tag">CAREER</span></a><nav class="site-tabs" aria-label="주요 화면">${tabs}</nav>${status}<a class="site-login" id="auth-link" href="/login/">로그인</a><details id="account-menu" class="account-menu" hidden><summary><span class="account-avatar" aria-hidden="true">${icon(3)}</span><span id="account-nickname">닉네임 확인 중…</span></summary><div class="account-options"><a href="/account/">마이페이지</a><a href="/notifications/">알림설정</a><a href="/resume/">지원준비</a><a href="/applications/">지원현황</a></div></details></header>`;
  page=page.replace(/<header\b[^>]*class="[^"]*\btopbar\b[^\"]*"[^>]*>[\s\S]*?<\/header>/,header);
  page=page.replace(/<script>(?=[\s\S]*?<\/script>)(?:(?!<\/script>)[\s\S])*?getElementById\("auth-link"\)(?:(?!<\/script>)[\s\S])*?<\/script>/g,'');
  page=page.replace('</body>',bottomNav(active,path)+'</body>');
  return versionAssets(page.replace('</head>','<link rel="stylesheet" href="/navigation.css"><script src="/navigation.js" defer></script></head>'),versions);
}

const paths=['<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v3h4v-3"/>','<path d="M4 21V3h12v18M16 9h4v12M8 7h4M8 11h4M8 15h4M8 21v-2h4v2"/>','<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM7 8h10M7 12h7"/>','<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'];
function icon(i){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[i]}</svg>`;}
function bottomNav(active,path){const member=/^\/(account|notifications|resume|applications|mail-connect)\//.test(path);return `<nav class="mobile-nav" aria-label="모바일 주요 화면">${[['/','공고'],['/firms/','법인'],['/board/','게시판'],['/account/','내정보']].map(([href,label],i)=>`<a href="${href}"${href===active||i===3&&member?' aria-current="page"':''}>${icon(i)}<span>${label}</span></a>`).join('')}</nav>`;}
function theme(page,path){
 const kind=path==='/'?'jobs':path.startsWith('/posting/')?'posting':path.startsWith('/firm/')?'firm':path.startsWith('/firms/')?'firms':path.startsWith('/board/')?'board':path.startsWith('/resume/')?'resume':path.startsWith('/applications/')?'applications':path.startsWith('/account/')?'account':path.startsWith('/notifications/')?'notifications':/^\/(login|onboarding|auth|mail-connect)/.test(path)?'auth':'document';
 page=page.replace(/<body([^>]*)>/,`<body$1 data-page="${kind}">`);
 page=page.replace('</head>','<link rel="stylesheet" href="/site-design.css"></head>');
 return page;
}
