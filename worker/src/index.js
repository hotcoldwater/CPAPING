/**
 * 정시에 한공회 크롤 워크플로를 띄운다.
 *
 * GitHub 의 schedule 이벤트는 부하가 높으면 조용히 건너뛴다. 반면
 * workflow_dispatch 도 실행 대기 시간이 생길 수 있으므로, 주기적인 복구 점검은
 * Cloudflare 가 맡고 실행은 그대로 GitHub 에서 한다.
 */

const GITHUB_API = "https://api.github.com";

const HEADERS = (env) => ({
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  // GitHub API 는 User-Agent 가 없으면 403 을 준다
  "User-Agent": "cpaping-cron",
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 크롤 워크플로를 띄운다. 성공하면 GitHub 은 204 를 준다.
 *
 * GitHub 은 이따금 502 같은 5xx 를 돌려준다(2026-09-09 00:59 KST 실측). 1분마다
 * 부르면 이런 일시 오류를 하루에도 몇 번 만난다. 5xx 와 네트워크 오류는 몇 초
 * 뒤 두 번까지 다시 시도한다. 4xx 는 다시 해도 같은 답이라 바로 실패로 본다.
 */
export async function dispatchWorkflow(env,workflow=env.GITHUB_WORKFLOW,inputs) {
  const url =
    `${GITHUB_API}/repos/${env.GITHUB_REPO}` +
    `/actions/workflows/${workflow}/dispatches`;

  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(3000 * attempt);
    try {
      const res = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: { ...HEADERS(env), "Content-Type": "application/json" },
        body: JSON.stringify({ ref: env.GITHUB_REF, ...(inputs?{inputs}: {}) }),
      });
      if (res.status === 204) return;
      const detail = (await res.text()).slice(0, 300);
      last = Object.assign(new Error(`GitHub ${res.status}: ${detail}`), { status: res.status });
      if (res.status < 500) throw last;         // 4xx — 다시 해도 같다
    } catch (err) {
      last = err.status ? err : Object.assign(err, { status: 0 });
      if (last.status && last.status < 500) throw last;
    }
  }
  throw last;
}

/**
 * 방금 1~2분 안에 실행이 생겼는지 본다. 502 를 받았어도 GitHub 이 요청은 받아
 * 실행을 만든 경우가 있다. 그럴 때 경고를 보내면 거짓 경보다.
 */
async function recentRunExists(env, withinMs = 120000) {
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/runs?event=workflow_dispatch&per_page=1`,
      { headers: HEADERS(env) });
    if (!res.ok) return false;
    const data = await res.json();
    const created = data.workflow_runs?.[0]?.created_at;
    return Boolean(created) && Date.now() - Date.parse(created) < withinMs;
  } catch {
    return false;
  }
}

/**
 * 트리거가 실패하면 아무도 모른다. 크롤러 자체의 장애 알림은 크롤러가
 * 돌아야 나가기 때문이다. 그래서 여기서 따로 알린다.
 *
 * 다만 1분마다 도는 시계가 실패마다 메일을 보내면, GitHub 장애 한 시간에
 * 메일이 60통 온다. 그래서 **10분에 한 번(분이 0·10·20…일 때)만** 보낸다.
 * 그 사이의 실패는 로그에만 남는다. 완전히 멈춘 경우는 healthchecks.io 가
 * 따로 잡는다(크롤러가 성공할 때마다 핑을 보낸다).
 */
async function alertFailure(env, err, topic="크롤 트리거") {
  if (!env.RESEND_API_KEY || !env.ALERT_MAIL_TO) return;
  const status = err.status || 0;
  const transient = status === 0 || status >= 500;
  const why = transient
    ? "GitHub 쪽 일시 오류(5xx 또는 네트워크)입니다. 세 번 시도했고, 이번 분은 건너뛰었습니다.\n" +
      "다음 분에 다시 시도합니다. 10분 넘게 이 메일이 이어지면 GitHub 상태를 확인하세요:\n" +
      "https://www.githubstatus.com"
    : "GitHub 이 요청을 거절했습니다. 토큰이 만료되었거나(Fine-grained PAT 은 만료일이 있습니다)\n" +
      "권한이 바뀌었을 수 있습니다. Worker 시크릿 GITHUB_TOKEN 을 확인하세요.";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM || "CPAPING <noreply@cpaping.com>",
        to: [env.ALERT_MAIL_TO],
        subject: `[CPAPING 경고] ${topic} 확인 필요`,
        text:
          `작업 상태를 확인해 주세요.\n\n${err.message}\n\n${topic==="크롤 트리거"?why:"1분 점검에서 미처리 작업을 다시 확인합니다."}\n\n` +
          `이 알림은 10분에 한 번만 옵니다. 실행 목록: https://github.com/${env.GITHUB_REPO}/actions`,
      }),
    });
  } catch (e) {
    console.error("경고 메일 발송 실패:", e.message);
  }
}

const WORKFLOWS={delivery:'delivery.yml',prepare:'resume.yml',analysis:'application-analysis.yml'};
// Suppress redundant runs; a new approval arriving during shutdown is recovered next minute.
export async function wakeWorkflow(env,kind){
 const workflow=WORKFLOWS[kind];if(!workflow)throw new Error('Unknown workflow');
 const response=await fetch(`${GITHUB_API}/repos/${env.GITHUB_REPO}/actions/workflows/${workflow}/runs?per_page=5`,{headers:HEADERS(env),signal:AbortSignal.timeout(5000)});
 if(response.ok){const data=await response.json();if(data.workflow_runs?.some(r=>['queued','pending','in_progress','waiting','requested'].includes(r.status)))return false;}
 await dispatchWorkflow(env,workflow);return true;
}
export async function checkWork(env){
 const response=await fetch(env.CAREER_PENDING_URL,{method:'POST',headers:{Authorization:'Bearer '+env.CAREER_DISPATCH_SECRET},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('Pending work check failed: '+response.status);
 const state=await response.json();
 const outcomes=await Promise.allSettled(Object.keys(WORKFLOWS).filter(k=>state[k]===true).map(k=>wakeWorkflow(env,k)));
 if(outcomes.some(r=>r.status==='rejected'))throw new Error('One or more career workers could not be started');
 console.log(JSON.stringify({event:'career-minute-check',warning_7_minutes:Math.max(state.oldest_analysis_seconds||0,state.oldest_delivery_seconds||0)>=420,oldest_analysis_seconds:state.oldest_analysis_seconds,oldest_delivery_seconds:state.oldest_delivery_seconds,overdue_count:state.overdue_count}));
 return state;
}
export default {
 async scheduled(event,env,ctx){
  // Career work must still run when the crawling trigger fails, and vice versa.
  const minute=new Date(event.scheduledTime).getUTCMinutes();
  const results=await Promise.allSettled([
   dispatchWorkflow(env,env.GITHUB_WORKFLOW,{fast:minute%10!==0}),
   env.CAREER_DISPATCH_SECRET&&env.CAREER_PENDING_URL?checkWork(env):Promise.resolve(null)
  ]);
  if(minute%10===0){
   for(let i=0;i<results.length;i++){
    const r=results[i];
    if(r.status==='rejected'){
     console.error(i===0?'Crawl trigger failed':'Career recovery failed',r.reason.message);
     if(i!==0||!await recentRunExists(env))ctx.waitUntil(alertFailure(env,r.reason,i===0?"크롤 트리거":"지원 작업 복구"));
    }else if(i===1&&r.value?.overdue_count>0)ctx.waitUntil(alertFailure(env,new Error('지원 처리 10분 초과 '+r.value.overdue_count+'건. 지원현황과 작업 실행을 확인해 주세요.'),'지원 처리 지연'));
   }
  }
  if(results.some(r=>r.status==='rejected'))throw new Error('Scheduled task failed');
 },
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/wake'){
   if(request.method!=='POST')return new Response('Method not allowed',{status:405});
   if(!env.CAREER_DISPATCH_SECRET||request.headers.get('Authorization')!=='Bearer '+env.CAREER_DISPATCH_SECRET)return new Response('Unauthorized',{status:401});
   try{await wakeWorkflow(env,'delivery');return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});}
   catch{return Response.json({error:'Dispatch failed'},{status:503});}
  }
  return Response.json({worker:'cpaping-cron',repo:env.GITHUB_REPO,workflow:env.GITHUB_WORKFLOW,tokenConfigured:Boolean(env.GITHUB_TOKEN),careerRecoveryConfigured:Boolean(env.CAREER_DISPATCH_SECRET&&env.CAREER_PENDING_URL),alertConfigured:Boolean(env.RESEND_API_KEY&&env.ALERT_MAIL_TO)});
 }
};
