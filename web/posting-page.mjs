/**
 * 공고 상세 페이지. 빌드할 때 공고마다 /posting/<ij_id>/ 로 찍어낸다.
 *
 * 한공회 원문을 전재하지 않는다(README 원칙). 제목·법인·지역·고용형태·마감·
 * 모집인원·경력·급여·학력처럼 목록에서 뽑은 값을 정리해 보여주고, 본문과
 * 담당자 연락처는 "한공회 원문 보기" 버튼 너머에 둔다. 지원·문의는 원문에서.
 *
 * 목록에서 공고를 누르면 한공회로 바로 나가지 않고 이 페이지로 온다.
 * 공고마다 URL 이 생겨 검색에 잡히고, 나중에 댓글이 붙을 자리이기도 하다.
 */

const SITE = "https://cpaping.com";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const shortDate = (iso) => (iso ? iso.slice(5).replace("-", ".") : "");
const longDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
};

function daysLeft(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

/** "[동성회계법인] 수습 회계사 채용" → "수습 회계사 채용" (firm-page 와 같은 규칙) */
function trimTitle(title, firmName) {
  let out = String(title || "").trim();
  const head = out.match(/^[[(【]([^\])】]{1,30})[\])】]\s*/);
  const bare = String(firmName || "").replace(/\s|\(.*\)/g, "");
  if (head && bare.length >= 3) {
    const inner = head[1].replace(/\s/g, "");
    if (inner.includes(bare) || inner.includes(bare.slice(0, 3))) out = out.slice(head[0].length);
  }
  return out.replace(/^[-—·\s]+/, "").replace(/-{2,}/g, " — ").trim() || title;
}

const JOB = { audit: "감사", tax: "세무", deal: "딜", etc: "기타" };

function status(p) {
  const left = daysLeft(p.deadline);
  if (p.removed_at) return { key: "removed", label: "공고 내림", left };
  if (left !== null && left < 0) return { key: "expired", label: "마감", left };
  if (left === 0) return { key: "today", label: "오늘 마감", left };
  return { key: "open", label: left === null ? "모집 중" : `D-${left}`, left };
}

/** Google 이 채용공고로 인식하게 하는 구조화 데이터. 열린 공고에만 붙인다 —
 *  내려간·마감된 공고에 남겨 두면 검색 결과에 죽은 공고가 뜬다. */
function jobPostingLd(p, firm, summary) {
  const url = `${SITE}/posting/${encodeURIComponent(p.ij_id)}/`;
  const anywhere = !p.region || /무관/.test(p.region);
  const ld = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: trimTitle(p.title, p.company_name),
    description: summary,
    datePosted: p.posted_at,
    ...(p.deadline ? { validThrough: `${p.deadline}T23:59:59+09:00` } : {}),
    employmentType: p.employment_type === "Part Time" ? "PART_TIME" : "FULL_TIME",
    hiringOrganization: {
      "@type": "Organization",
      name: p.company_name,
      ...(firm ? { sameAs: `${SITE}/firm/${encodeURIComponent(firm.slug)}/` } : {}),
    },
    ...(anywhere
      ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "대한민국" } }
      : { jobLocation: { "@type": "Place", address: { "@type": "PostalAddress",
            addressLocality: p.work_region || p.region, addressCountry: "KR" } } }),
    directApply: false,
    url,
  };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`;
}

export function renderPostingPage({ posting: p, firm, latestFin, others }) {
  const st = status(p);
  const title = trimTitle(p.title, p.company_name);
  const firmUrl = firm ? `/firm/${encodeURIComponent(firm.slug)}/` : null;
  const region = p.work_region && p.work_region !== p.region && !/무관/.test(p.work_region)
    ? p.work_region : p.region;
  const pt = p.employment_type === "Part Time";
  const job = JOB[p.job_category];
  const isNew = st.key === "open" && p.posted_at &&
    (Date.now() - new Date(p.posted_at)) / 86400000 <= 3 && !p.original_posted_at;

  // 요약 문장 — meta description 과 JobPosting.description 이 함께 쓴다
  const bits = [
    `${p.company_name}의 ${pt ? "파트타임 " : ""}수습회계사 공고.`,
    region ? `근무지 ${region}.` : "",
    p.headcount ? `모집인원 ${p.headcount}.` : "",
    p.deadline ? `마감 ${longDate(p.deadline)}.` : "",
    p.salary ? `급여 ${p.salary}.` : "",
    "한국공인회계사회 구인(수습CPA) 게시판에 올라온 공고를 정리한 것으로, 지원과 문의는 원문에서 합니다.",
  ].filter(Boolean);
  const summary = bits.join(" ");

  const rows = [
    ["근무지역", region],
    ["고용형태", pt ? "파트타임" : "정규직"],
    ["직무", job],
    ["모집인원", p.headcount],
    ["경력", p.career],
    ["급여", p.salary],
    ["학력", p.education],
    ["등록일", longDate(p.posted_at)],
    ["마감일", p.deadline ? `${longDate(p.deadline)}${st.key === "open" ? ` (D-${st.left})` : ""}` : null],
    ["게시판 상태", p.hiring_status],
  ].filter(([, v]) => v);

  const otherRows = (others || []).slice(0, 6).map((o) => {
    const os = status(o);
    return `<a class="row${os.key === "removed" || os.key === "expired" ? " closed" : ""}"
        href="/posting/${encodeURIComponent(o.ij_id)}/">
      <div><div class="meta">${esc(shortDate(o.posted_at))} 등록</div>
        <div class="t">${esc(trimTitle(o.title, o.company_name))}</div></div>
      <div class="due">${esc(os.label)}</div></a>`;
  }).join("");

  const finCard = firm ? `
    <section class="card">
      <div class="sec-head"><h2>이 법인</h2><a class="more" href="${firmUrl}">법인 정보 전체 →</a></div>
      <div class="firm-line"><a class="fname" href="${firmUrl}">${esc(firm.name)}</a>
        ${firm.region ? `<span class="muted">${esc(firm.region)}</span>` : ""}</div>
      ${latestFin ? `<dl class="facts">
        ${latestFin.cpa_count != null ? `<div><dt>회계사</dt><dd>${Number(latestFin.cpa_count).toLocaleString("ko-KR")}명</dd></div>` : ""}
        ${latestFin.revenue != null ? `<div><dt>매출</dt><dd>${Math.round(latestFin.revenue).toLocaleString("ko-KR")}억</dd></div>` : ""}
        ${latestFin.trainee_count != null ? `<div><dt>수습회계사</dt><dd>${latestFin.trainee_count}명</dd></div>` : ""}
        <div><dt>기준</dt><dd>${esc(String(latestFin.fiscal_year).slice(0, 4))}년 사업보고서</dd></div>
      </dl>` : `<p class="muted small">재무·인력 자료는 준비 중입니다.</p>`}
    </section>` : "";

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.company_name)} ${esc(title)} | CPAPING</title>
<meta name="description" content="${esc(summary)}">
<link rel="canonical" href="${SITE}/posting/${encodeURIComponent(p.ij_id)}/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="CPAPING">
<meta property="og:title" content="${esc(p.company_name)} — ${esc(title)}">
<meta property="og:description" content="${esc(summary)}">
<meta property="og:url" content="${SITE}/posting/${encodeURIComponent(p.ij_id)}/">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:locale" content="ko_KR">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#123A8A">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/comments.css">
${st.key === "open" || st.key === "today" ? jobPostingLd(p, firm, summary) : ""}
<style>
:root{--ink:#101317;--ink-2:#5B6472;--ink-3:#868D99;--line:#E4E6EA;--line-2:#EDEFF2;--bg:#fff;--bg-subtle:#FBFBFC;
--bg-hover:#F7F9FC;--accent:#123A8A;--urgent:#B4341F;--live:#17A05F;--chip-bg:#EEF1F6;--chip-fg:#4A5462;
--chip-pt-bg:#FBF0E4;--chip-pt-fg:#8A5A19;--radius:4px;--pad-x:18px}
*{box-sizing:border-box}
body{margin:0;background:var(--bg-subtle);color:var(--ink);font-family:"IBM Plex Sans KR","Pretendard","Apple SD Gothic Neo",-apple-system,sans-serif;font-size:14px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit}
.shell{max-width:720px;margin:0 auto;min-height:100vh;background:var(--bg);border-inline:1px solid var(--line);display:flex;flex-direction:column}
@media(max-width:720px){.shell{border-inline:0}}
.topbar{height:44px;display:flex;align-items:center;gap:14px;padding:0 var(--pad-x);background:var(--bg-subtle);border-bottom:1px solid var(--line)}
.wordmark{font-weight:600;font-size:13.5px;letter-spacing:-.01em;text-decoration:none}
.topbar nav a{font-size:13px;color:var(--ink-2);text-decoration:none;padding:4px 10px;border-radius:var(--radius)}
.topbar nav a[aria-current]{background:var(--chip-bg);color:var(--ink);font-weight:500}
.topbar .me{margin-left:auto;font-size:12.5px;color:var(--ink-2);text-decoration:none;padding:4px 10px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg)} .topbar .me:hover{color:var(--accent);border-color:var(--accent)}
.head{padding:22px var(--pad-x) 18px;border-bottom:1px solid var(--line)}
.crumb{font-size:12px;color:var(--ink-2);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.crumb a{color:var(--ink-2);text-decoration:none;font-weight:500}
.crumb a:hover{color:var(--accent);text-decoration:underline}
.badge{font-size:9.5px;font-weight:700;letter-spacing:.06em;padding:1px 5px;border-radius:2px;color:#fff;background:var(--accent)}
.badge.repost{background:var(--chip-pt-bg);color:var(--chip-pt-fg);font-weight:600;letter-spacing:0}
.badge.closed{background:var(--chip-bg);color:var(--chip-fg);font-weight:600;letter-spacing:0}
h1{margin:8px 0 10px;font-size:21px;font-weight:600;letter-spacing:-.02em;line-height:1.35;text-wrap:balance}
.chips{display:flex;gap:5px;flex-wrap:wrap}
.chip{font-size:11px;padding:2px 7px;border-radius:2px;background:var(--chip-bg);color:var(--chip-fg)}
.chip.pt{background:var(--chip-pt-bg);color:var(--chip-pt-fg)}
.status{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line-2)}
.dday{font-size:22px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.dday.soon{color:var(--urgent)} .dday.closed{color:var(--ink-3);font-weight:500;font-size:16px}
.dday small{display:block;font-size:11.5px;color:var(--ink-3);font-weight:400;letter-spacing:0}
.cta{display:flex;gap:8px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:500;padding:10px 16px;border-radius:var(--radius);text-decoration:none;border:1px solid var(--line);color:var(--ink-2);background:var(--bg)}
.btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn:hover{border-color:var(--accent);color:var(--accent)} .btn.primary:hover{color:#fff;opacity:.92}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
main{flex:1;padding:0 var(--pad-x) 32px}
section{padding:20px 0;border-bottom:1px solid var(--line-2)}
section:last-of-type{border-bottom:0}
.sec-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px}
.sec-head h2{margin:0;font-size:14px;font-weight:600;letter-spacing:-.01em}
.sec-head .more,.sec-head .unit{font-size:12px;color:var(--ink-2);text-decoration:none}
.sec-head .more:hover{color:var(--accent);text-decoration:underline}
dl.facts{display:grid;grid-template-columns:repeat(2,1fr);gap:0 24px;margin:0}
dl.facts>div{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--line-2);font-size:13.5px}
dl.facts dt{color:var(--ink-2);margin:0;white-space:nowrap} dl.facts dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
@media(max-width:560px){dl.facts{grid-template-columns:1fr}}
.note{margin:12px 0 0;font-size:12px;color:var(--ink-3);line-height:1.65}
.card .firm-line{display:flex;gap:10px;align-items:baseline;margin-bottom:6px}
.fname{font-size:15px;font-weight:600;text-decoration:none} .fname:hover{color:var(--accent)}
.muted{color:var(--ink-3)} .small{font-size:12.5px}
.rows{display:flex;flex-direction:column}
.row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line-2);text-decoration:none}
.row:last-child{border-bottom:0} .row:hover .t{color:var(--accent)}
.row .meta{font-size:11.5px;color:var(--ink-3)} .row .t{font-size:13.5px;font-weight:500}
.row .due{font-size:12.5px;font-variant-numeric:tabular-nums;color:var(--ink-2)} .row.closed .due,.row.closed .t{color:var(--ink-3)}
.sub{margin:0;padding:18px var(--pad-x);background:var(--bg-subtle);border-top:1px solid var(--line);font-size:13px;color:var(--ink-2)}
.sub a{color:var(--accent);font-weight:500}
footer{padding:16px var(--pad-x);background:var(--bg-subtle);border-top:1px solid var(--line);font-size:11.5px;color:var(--ink-3);line-height:1.7;text-align:center}
footer a{color:var(--ink-2)}
</style>
</head>
<body>
<div class="shell">
  <header class="topbar">
    <a class="wordmark" href="/">CPAPING</a>
    <nav aria-label="주요 화면"><a href="/" aria-current="page">공고</a><a href="/firms/">법인</a></nav>
    <a class="me" id="auth-link" href="/login/">로그인</a>
<script>(function(){try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(/^sb-.*-auth-token$/.test(k)&&localStorage.getItem(k)){var a=document.getElementById("auth-link");a.textContent="내 계정";a.href="/account/";break;}}}catch(e){}})();</script>
  </header>

  <div class="head">
    <div class="crumb">
      ${firmUrl ? `<a href="${firmUrl}">${esc(p.company_name)}</a>` : `<span>${esc(p.company_name)}</span>`}
      <span class="muted">· ${esc(shortDate(p.posted_at))} 등록</span>
      ${p.original_posted_at ? `<span class="badge repost">끌올 · 최초 ${esc(shortDate(p.original_posted_at))}</span>` : ""}
      ${isNew ? `<span class="badge">NEW</span>` : ""}
      ${st.key === "removed" ? `<span class="badge closed">공고 내림</span>` : st.key === "expired" ? `<span class="badge closed">마감</span>` : ""}
    </div>
    <h1>${esc(title)}</h1>
    <div class="chips">
      ${region ? `<span class="chip">${esc(region)}</span>` : ""}
      <span class="chip${pt ? " pt" : ""}">${pt ? "파트타임" : "정규직"}</span>
      ${job ? `<span class="chip">${esc(job)}</span>` : ""}
    </div>
    <div class="status">
      <div class="cta">
        <a class="btn${st.key === "removed" ? "" : " primary"}" href="${esc(p.detail_url)}" target="_blank" rel="noopener">한공회 원문 보기 ↗</a>
        ${firmUrl ? `<a class="btn" href="${firmUrl}">법인 정보</a>` : ""}
      </div>
      <div class="dday${st.key === "removed" || st.key === "expired" ? " closed" : (st.left !== null && st.left <= 7 ? " soon" : "")}">
        ${esc(st.label)}${p.deadline ? `<small>${esc(shortDate(p.deadline))} 마감</small>` : ""}
      </div>
    </div>
  </div>

  <main>
    <section>
      <div class="sec-head"><h2>공고 요약</h2><span class="unit">한공회 게시판 기준</span></div>
      <dl class="facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      <p class="note">공고 본문과 담당자 연락처는 원문에서 확인하세요. CPAPING은 원문을 전재하지 않고
        게시판에 적힌 항목만 정리합니다.${st.key === "removed" ? " 이 공고는 게시판에서 내려갔습니다 — 한공회는 등록 1개월이 지난 공고를 자동으로 지우며, 원문 링크가 열리지 않을 수 있습니다." : ""}</p>
    </section>
    ${finCard}
    ${otherRows ? `<section>
      <div class="sec-head"><h2>${esc(p.company_name)}의 다른 공고</h2><span class="unit">${others.length}건</span></div>
      <div class="rows">${otherRows}</div>
    </section>` : ""}
  </main>

  <section class="comments" id="comments" data-target-type="posting" data-target-id="${esc(p.ij_id)}">
    <div class="sec-head"><h2>댓글</h2></div>
    <p class="muted small">댓글을 불러오는 중…</p>
  </section>
  <script src="/comments.js" defer></script>

  <p class="sub">이런 공고가 올라오면 1분 안에 메일로 받으세요 — <a href="/login/">가입하기</a></p>
  <footer>한국공인회계사회 구인(수습CPA) 게시판의 공고를 정리했습니다 · 잘못된 내용은
    <a href="mailto:contact@cpaping.com">contact@cpaping.com</a><br>
    <a href="/">공고 목록</a> · <a href="/firms/">법인</a> · <a href="/terms">이용약관</a> · <a href="/privacy">개인정보처리방침</a></footer>
</div>
</body>
</html>`;
}
