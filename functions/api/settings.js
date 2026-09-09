/**
 * 구독 조건 변경.
 *
 *   GET  /api/settings?token=...   현재 조건을 보여주고 바꿀 수 있는 화면
 *   POST /api/settings             (폼) token, kind(여러 개: full/part/career), region → 저장
 *
 * 로그인이 없다. 알림 메일 하단의 링크에 실린 **해지 토큰**이 곧 인증이다 —
 * 메일을 받은 사람만 그 링크를 갖고 있고, 토큰은 추측할 수 없다(24바이트).
 * 조건이 고용형태·지역 두 축이 되면서 "왜 이 공고는 안 왔지" 가 생길 수
 * 있는데, 그 전에는 해지하고 다시 신청하는 것 말고는 바꿀 길이 없었다.
 *
 * 화면에 이메일은 가려서 보여준다. 링크를 누른 사람은 자기 주소를 알고 있고,
 * 메일 클라이언트가 링크를 미리 열어 보는 경우가 있어 전부 보일 이유가 없다.
 */

import { supabase, page, SITE } from "../_shared.js";

// 받을 공고 종류. 여러 개 고를 수 있고 하나는 골라야 한다.
const KINDS = [
  ["full", "수습 정규직", "구인(수습CPA) 게시판의 정규직 공고", "want_trainee_full"],
  ["part", "수습 파트타임", "구인(수습CPA) 게시판의 파트타임 공고", "want_trainee_part"],
  ["career", "경력", "구인(CPA) 게시판의 회계사 경력 채용. 빅4·일반기업 포함, 기장·사무 직원 공고는 제외", "want_career"],
];
const REGIONS = [
  ["all", "전국", "모든 지역"],
  ["capital", "수도권", "서울·경기·인천"],
  ["local", "지방", "수도권을 뺀 나머지"],
];

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** abc***@naver.com — 누구인지 구분은 되되 그대로 노출하지는 않는다. */
function mask(email) {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  const local = email.slice(0, at);
  const head = local.length > 3 ? local.slice(0, 3) : local.slice(0, 1);
  return `${head}***${email.slice(at)}`;
}

async function findByToken(env, token) {
  const rows = await supabase(
    env,
    `subscribers?select=id,email,status,employment_filter,region_filter,want_trainee_full,want_trainee_part,want_career` +
      `&unsubscribe_token=eq.${encodeURIComponent(token)}`
  );
  return rows[0] || null;
}

function radios(name, options, current) {
  return options
    .map(([value, label, hint]) => {
      const id = `${name}-${value}`;
      return `<label class="opt" for="${id}">
  <input type="radio" id="${id}" name="${name}" value="${value}"${value === current ? " checked" : ""}>
  <span class="lb">${esc(label)}</span><span class="hint">${esc(hint)}</span>
</label>`;
    })
    .join("\n");
}

function checks(row) {
  return KINDS.map(([value, label, hint, col]) => {
    const id = `kind-${value}`;
    const on = col === "want_career" ? row[col] === true : row[col] !== false;
    return `<label class="opt" for="${id}">
  <input type="checkbox" id="${id}" name="kind" value="${value}"${on ? " checked" : ""}>
  <span class="lb">${esc(label)}</span><span class="hint">${esc(hint)}</span>
</label>`;
  }).join("\n");
}

function settingsPage({ row, token, saved = false, error = "" }) {
  const status = row.status === "active"
    ? `<span class="chip on">구독 중</span>`
    : `<span class="chip">확인 대기</span>`;
  const unsubscribe = `${SITE}/api/unsubscribe?token=${encodeURIComponent(token)}`;

  return new Response(
    `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>구독 설정 — CPAPING</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap">
<style>
  :root { --ink:#101317; --ink-2:#5B6472; --ink-3:#868D99; --line:#E4E6EA;
          --bg:#FBFBFC; --accent:#123A8A; --ok:#17A05F; --ok-bg:#E6F5ED; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font-family:'IBM Plex Sans KR',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;
         font-size:14px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:720px; margin:0 auto; min-height:100vh; background:#fff;
          border-inline:1px solid var(--line); display:flex; flex-direction:column; }
  @media (max-width:720px) { .wrap { border-inline:0; } }
  .bar { height:44px; display:flex; align-items:center; gap:16px; padding:0 18px;
         background:var(--bg); border-bottom:1px solid var(--line); }
  .bar .brand { font-size:13.5px; font-weight:600; letter-spacing:-.01em; color:var(--ink); text-decoration:none; }
  .bar a.nav { font-size:13px; color:var(--ink-2); text-decoration:none; }
  main { flex:1; padding:28px 18px 48px; max-width:520px; width:100%; margin:0 auto; }
  h1 { margin:0 0 4px; font-size:19px; font-weight:600; letter-spacing:-.02em; }
  .who { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--ink-2); margin-bottom:22px; }
  .chip { font-size:10.5px; padding:1px 7px; border:1px solid var(--line); border-radius:3px; color:var(--ink-3); }
  .chip.on { color:var(--ok); border-color:transparent; background:var(--ok-bg); }
  .saved { margin:0 0 18px; padding:10px 12px; font-size:13px; color:var(--ok);
           background:var(--ok-bg); border-radius:4px; }
  fieldset { border:0; padding:0; margin:0 0 22px; }
  legend { font-size:11.5px; font-weight:600; letter-spacing:.06em; color:var(--ink-3);
           text-transform:uppercase; padding:0; margin-bottom:8px; }
  .opt { display:grid; grid-template-columns:18px 1fr; column-gap:10px; align-items:baseline;
         padding:10px 12px; border:1px solid var(--line); border-radius:4px; margin-bottom:6px;
         cursor:pointer; background:#fff; }
  .opt:has(input:checked) { border-color:var(--accent); background:#F4F7FC; }
  .opt input { margin:0; accent-color:var(--accent); align-self:center; }
  .opt .lb { font-size:13.5px; font-weight:500; }
  .opt .hint { grid-column:2; font-size:12px; color:var(--ink-3); }
  .note { font-size:12px; color:var(--ink-3); margin:-10px 0 22px; }
  .act { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  button { font:inherit; font-size:13.5px; font-weight:500; padding:10px 20px; border:0;
           border-radius:4px; background:var(--accent); color:#fff; cursor:pointer; }
  button:focus-visible, .opt:focus-within, a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  a.back { font-size:13px; color:var(--ink-2); }
  .danger { margin-top:34px; padding-top:18px; border-top:1px solid var(--line); font-size:12.5px; color:var(--ink-3); }
  .danger a { color:var(--ink-2); }
  footer { padding:20px 18px; background:var(--bg); border-top:1px solid var(--line);
           font-size:11.5px; color:var(--ink-3); text-align:center; }
</style>
</head><body>
<div class="wrap">
  <div class="bar"><a class="brand" href="/">CPAPING</a><a class="nav" href="/">공고</a><a class="nav" href="/firms/">법인</a></div>
  <main>
    <h1>구독 설정</h1>
    <div class="who">${esc(mask(row.email))} ${status}</div>
    ${saved ? `<p class="saved" role="status">저장했습니다. 다음 공고부터 이 조건으로 보냅니다.</p>` : ""}
    ${error ? `<p class="saved" role="alert" style="color:#C7462A;background:#FBEBE7">${esc(error)}</p>` : ""}
    <form method="post" action="/api/settings">
      <input type="hidden" name="token" value="${esc(token)}">
      <fieldset>
        <legend>받을 공고</legend>
        ${checks(row)}
      </fieldset>
      <fieldset>
        <legend>지역</legend>
        ${radios("region", REGIONS, row.region_filter || "all")}
      </fieldset>
      <p class="note">지역무관 공고는 어느 조건에서도 함께 받습니다.</p>
      <div class="act">
        <button type="submit">저장</button>
        <a class="back" href="/">공고 보러 가기</a>
      </div>
    </form>
    <p class="danger">알림을 그만 받으시려면 <a href="${esc(unsubscribe)}">구독 해지</a>.
      누르는 즉시 이메일 주소를 포함한 구독 정보가 삭제됩니다.</p>
  </main>
  <footer>CPAPING · 한국공인회계사회 공고를 수집합니다</footer>
</div>
</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
  );
}

function invalidLink() {
  return page({
    title: "링크가 올바르지 않습니다",
    lead: "구독 설정 링크가 잘못되었거나 잘려 있습니다.",
    sub: "알림 메일 하단의 '구독 설정' 을 다시 눌러 주세요.",
  });
}

function expiredLink() {
  return page({
    title: "만료된 링크입니다",
    lead: "해지되었거나 더 이상 유효하지 않은 구독입니다.",
    sub: "다시 받아보시려면 사이트에서 새로 신청해 주세요.",
    linkText: "다시 신청하기",
  });
}

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return invalidLink();
  try {
    const row = await findByToken(env, token);
    if (!row) return expiredLink();
    return settingsPage({ row, token });
  } catch (err) {
    console.error("구독 설정 조회 실패:", err.message);
    return page({ title: "처리하지 못했습니다", lead: "잠시 후 링크를 다시 눌러 주세요." });
  }
}

export async function onRequestPost({ request, env }) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return invalidLink();
  }
  const token = String(form.get("token") || "");
  if (!token) return invalidLink();

  // 화이트리스트 밖의 값은 무시하고 현재 값을 유지한다. DB 의 CHECK 제약이
  // 마지막 방어선이지만, 거기까지 가면 사용자에게 500 이 보인다.
  const kinds = form.getAll("kind").filter((v) => KINDS.some(([k]) => k === v));
  const region = REGIONS.some(([v]) => v === form.get("region")) ? form.get("region") : null;

  try {
    const row = await findByToken(env, token);
    if (!row) return expiredLink();
    if (!kinds.length) return settingsPage({ row, token, error: "받을 공고를 하나 이상 골라 주세요. 알림을 그만 받으시려면 아래 구독 해지를 누르세요." });

    const patch = {
      want_trainee_full: kinds.includes("full"),
      want_trainee_part: kinds.includes("part"),
      want_career: kinds.includes("career"),
    };
    // 예전 컬럼도 맞춰 둔다
    patch.employment_filter = patch.want_trainee_full && !patch.want_trainee_part ? "full"
      : !patch.want_trainee_full && patch.want_trainee_part ? "part" : "all";
    if (region) patch.region_filter = region;
    if (Object.keys(patch).length) {
      await supabase(env, `subscribers?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
    }
    return settingsPage({ row: { ...row, ...patch }, token, saved: true });
  } catch (err) {
    console.error("구독 설정 저장 실패:", err.message);
    return page({ title: "저장하지 못했습니다", lead: "잠시 후 다시 시도해 주세요." });
  }
}
