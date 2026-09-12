export function navigation(page,path='/') {
  if(!/<header\b[^>]*class="[^"]*\btopbar\b/.test(page))return page;
  const active=path.startsWith('/firm')?'/firms/':path.startsWith('/essay')?'/essay/':path.startsWith('/board')?'/board/':path==='/'||path.startsWith('/posting')?'/':null;
  const tabs=[['/','공고'],['/firms/','법인'],['/essay/','자소서'],['/board/','게시판']].map(([href,label])=>`<a href="${href}"${href===active?' aria-current="page"':''}>${label}</a>`).join('');
  const status=page.match(/<div class="status">[\s\S]*?<\/div>/)?.[0]||'';
  const header=`<header class="topbar site-topbar"><a class="wordmark" href="/">CPAPING</a><nav class="site-tabs" aria-label="주요 화면">${tabs}</nav>${status}<a class="site-login" id="auth-link" href="/login/">로그인</a><details id="account-menu" class="account-menu" hidden><summary>마이페이지</summary><div class="account-options"><a href="/applications/">내 지원현황</a><a href="/account/">내 정보</a></div></details></header>`;
  page=page.replace(/<header\b[^>]*class="[^"]*\btopbar\b[^\"]*"[^>]*>[\s\S]*?<\/header>/,header);
  page=page.replace(/<script>(?=[\s\S]*?<\/script>)(?:(?!<\/script>)[\s\S])*?getElementById\("auth-link"\)(?:(?!<\/script>)[\s\S])*?<\/script>/g,'');
  return page.replace('</head>','<link rel="stylesheet" href="/navigation.css"><script src="/navigation.js" defer></script></head>');
}
