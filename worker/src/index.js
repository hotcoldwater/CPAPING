/**
 * 정시에 한공회 크롤 워크플로를 띄운다.
 *
 * GitHub 의 schedule 이벤트는 부하가 높으면 조용히 건너뛴다. 반면
 * workflow_dispatch 로 띄운 실행은 즉시 시작하므로, 정확한 시계 역할만
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
async function dispatchWorkflow(env) {
  const url =
    `${GITHUB_API}/repos/${env.GITHUB_REPO}` +
    `/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;

  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(3000 * attempt);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...HEADERS(env), "Content-Type": "application/json" },
        body: JSON.stringify({ ref: env.GITHUB_REF }),
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
      `${GITHUB_API}/repos/${env.GITHUB_REPO}/actions/runs?event=workflow_dispatch&per_page=1`,
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
async function alertFailure(env, err) {
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
        subject: transient ? "[CPAPING 경고] 크롤 트리거 일시 실패" : "[CPAPING 경고] 크롤 트리거 거절됨 — 토큰 확인",
        text:
          `크롤 워크플로를 띄우지 못했습니다.\n\n${err.message}\n\n${why}\n\n` +
          `이 알림은 10분에 한 번만 옵니다. 실행 목록: https://github.com/${env.GITHUB_REPO}/actions`,
      }),
    });
  } catch (e) {
    console.error("경고 메일 발송 실패:", e.message);
  }
}

export default {
  async scheduled(event, env, ctx) {
    try {
      await dispatchWorkflow(env);
      console.log(`크롤 트리거 완료 (cron: ${event.cron})`);
    } catch (err) {
      console.error("크롤 트리거 실패:", err.message);
      ctx.waitUntil((async () => {
        // 502 를 받았어도 실행이 만들어졌으면 실패가 아니다
        if (await recentRunExists(env)) {
          console.log("실행은 생성됨 — 경고 생략");
          return;
        }
        const minute = new Date(event.scheduledTime).getUTCMinutes();
        if (minute % 10 !== 0) {
          console.log("경고는 10분 단위 회차에만 보낸다 — 생략");
          return;
        }
        await alertFailure(env, err);
      })());
      throw err;
    }
  },

  /**
   * 상태 확인용. 여기서 크롤을 띄우지는 않는다.
   * 공개 URL 에 트리거를 열어두면 누구나 워크플로를 돌릴 수 있기 때문이다.
   */
  async fetch(request, env) {
    const body = {
      worker: "cpaping-cron",
      repo: env.GITHUB_REPO,
      workflow: env.GITHUB_WORKFLOW,
      tokenConfigured: Boolean(env.GITHUB_TOKEN),
      alertConfigured: Boolean(env.RESEND_API_KEY && env.ALERT_MAIL_TO),
      note: "크롤은 예약 시각에만 실행됩니다. 수동 실행은 gh workflow run 을 쓰세요.",
    };
    return new Response(JSON.stringify(body, null, 2), {
      status: body.tokenConfigured ? 200 : 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },
};
