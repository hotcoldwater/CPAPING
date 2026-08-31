/**
 * Pages Functions 공용 헬퍼.
 *
 * 구독 신청을 브라우저에서 Supabase 로 직접 넣게 두면 공개 키만 알면
 * 누구나 대량 등록할 수 있다. 그래서 서버를 한 겹 두고, secret key 는
 * 여기서만 쓴다. secret key 는 절대 브라우저로 나가지 않는다.
 */

export const SITE = "https://cpaping.com";

/** Supabase REST 호출. env 는 Pages 의 환경변수. */
export async function supabase(env, path, options = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    // 설정 누락을 네트워크 오류처럼 보이게 두면 원인을 찾기 어렵다
    throw new Error(
      "환경변수 누락: " +
        [!env.SUPABASE_URL && "SUPABASE_URL", !env.SUPABASE_SECRET_KEY && "SUPABASE_SECRET_KEY"]
          .filter(Boolean)
          .join(", ")
    );
  }
  const url = `${env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Supabase ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 추측할 수 없는 토큰. 확인·해지 링크에 쓴다. */
export function token() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 이메일 형식 검사. 지나치게 엄격한 정규식은 정상 주소를 막으므로
 * 최소한만 본다.
 */
export function normalizeEmail(raw) {
  const email = String(raw || "").trim();
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return { email, normalized: email.toLowerCase() };
}

/**
 * Resend 로 메일을 보낸다. 키가 없으면 조용히 건너뛴다.
 * 그 경우 크롤러가 다음 실행 때 확인 메일을 대신 보낸다.
 */
export async function sendMail(env, { to, subject, html, text, headers }) {
  if (!env.RESEND_API_KEY) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || "CPAPING <noreply@cpaping.com>",
      to: [to],
      // 답장이 곧 피드백이 되도록. 사이트로 돌아올 필요가 없다.
      reply_to: env.REPLY_TO || "contact@cpaping.com",
      subject,
      html,
      text,
      ...(headers ? { headers } : {}),
    }),
  });
  if (!res.ok) {
    console.error("Resend 실패:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/** 안내 페이지. 사이트와 같은 톤으로 최소한만 그린다. */
export function page({ title, lead, sub, linkText = "공고 보러 가기", href = SITE }) {
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  return new Response(
    `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — CPAPING</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap">
<style>
  body { margin:0; background:#FBFBFC; color:#101317;
         font-family:'IBM Plex Sans KR',-apple-system,BlinkMacSystemFont,sans-serif;
         font-size:14px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:720px; margin:0 auto; min-height:100vh; background:#fff;
          border-inline:1px solid #E4E6EA; display:flex; flex-direction:column; }
  .bar { height:44px; display:flex; align-items:center; padding:0 18px;
         background:#FBFBFC; border-bottom:1px solid #E4E6EA;
         font-size:13.5px; font-weight:600; letter-spacing:-.01em; }
  main { flex:1; display:flex; flex-direction:column; align-items:center;
         justify-content:center; text-align:center; padding:48px 18px; gap:8px; }
  h1 { margin:0; font-size:19px; font-weight:600; letter-spacing:-.02em; }
  p { margin:0; font-size:13px; color:#5B6472; }
  a.cta { margin-top:20px; display:inline-block; padding:10px 18px;
          background:#123A8A; color:#fff; text-decoration:none;
          border-radius:4px; font-size:13.5px; font-weight:500; }
  footer { padding:20px 18px; background:#FBFBFC; border-top:1px solid #E4E6EA;
           font-size:11.5px; color:#868D99; text-align:center; }
</style>
</head><body>
<div class="wrap">
  <div class="bar">CPAPING</div>
  <main>
    <h1>${esc(title)}</h1>
    <p>${esc(lead)}</p>
    ${sub ? `<p>${esc(sub)}</p>` : ""}
    <a class="cta" href="${esc(href)}">${esc(linkText)}</a>
  </main>
  <footer>CPAPING · 한국공인회계사회 공고를 수집합니다</footer>
</div>
</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
