/**
 * 정시에 한공회 크롤 워크플로를 띄운다.
 *
 * GitHub 의 schedule 이벤트는 부하가 높으면 조용히 건너뛴다. 반면
 * workflow_dispatch 로 띄운 실행은 즉시 시작하므로, 정확한 시계 역할만
 * Cloudflare 가 맡고 실행은 그대로 GitHub 에서 한다.
 */

const GITHUB_API = "https://api.github.com";

/** 크롤 워크플로를 띄운다. 성공하면 GitHub 은 204 를 준다. */
async function dispatchWorkflow(env) {
  const url =
    `${GITHUB_API}/repos/${env.GITHUB_REPO}` +
    `/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // GitHub API 는 User-Agent 가 없으면 403 을 준다
      "User-Agent": "cpaping-cron",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: env.GITHUB_REF }),
  });

  if (res.status !== 204) {
    const detail = await res.text();
    throw new Error(`GitHub ${res.status}: ${detail.slice(0, 300)}`);
  }
}

/**
 * 트리거가 실패하면 아무도 모른다. 크롤러 자체의 장애 알림은 크롤러가
 * 돌아야 나가기 때문이다. 그래서 여기서 따로 알린다.
 */
async function alertFailure(env, message) {
  if (!env.RESEND_API_KEY || !env.ALERT_MAIL_TO) return;
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
        subject: "[CPAPING 경고] 크롤 트리거 실패",
        text:
          `크롤 워크플로를 띄우지 못했습니다.\n\n${message}\n\n` +
          `토큰이 만료되었거나 권한이 바뀌었을 수 있습니다.\n` +
          `확인: https://github.com/${env.GITHUB_REPO}/actions`,
      }),
    });
  } catch (err) {
    console.error("경고 메일 발송 실패:", err.message);
  }
}

export default {
  async scheduled(event, env, ctx) {
    try {
      await dispatchWorkflow(env);
      console.log(`크롤 트리거 완료 (cron: ${event.cron})`);
    } catch (err) {
      console.error("크롤 트리거 실패:", err.message);
      // 알림 발송이 끝날 때까지 Worker 가 살아 있도록 붙잡아 둔다
      ctx.waitUntil(alertFailure(env, err.message));
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
