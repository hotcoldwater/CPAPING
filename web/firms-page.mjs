/**
 * /firms — 회계법인 비교표.
 *
 * 공고는 한 달이면 사라지지만 이 표는 남는다. 검색으로 들어오는 사람이
 * 가장 먼저 닿는 화면이 될 곳이라 서버에서 다 그려 내보낸다.
 *
 * 정렬·거르기는 브라우저에서 한다. 250곳 남짓이라 통째로 실어도
 * 60KB 안쪽이고, 그러면 서버도 로그인도 필요 없다.
 */

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** '서울특별시 강남구 테헤란로 8길 21' → '서울 강남구' */
export function shortRegion(address) {
  if (!address) return null;
  const m = String(address).match(
    /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\S*\s*(\S*[시군구])?/);
  if (!m) return null;
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

/**
 * 법인 하나를 표의 한 줄로 만든다.
 * 재무가 한 해도 없으면 null — 비교할 것이 없는 줄은 싣지 않는다.
 */
function toRow(firm, years) {
  const rows = years
    .filter((r) => r.revenue > 0 && r.cpa_count > 0)
    .sort((a, b) => a.fiscal_year.localeCompare(b.fiscal_year));
  if (!rows.length) return null;

  const last = rows[rows.length - 1];
  const first = rows[0];
  const rev = Number(last.revenue);
  const cpa = last.cpa_count;
  const partners = last.partner_count ?? 0;

  const seg = ["revenue_audit", "revenue_tax", "revenue_deal", "revenue_other"]
    .map((k) => Number(last[k] ?? 0));
  const segSum = seg.reduce((a, b) => a + b, 0);

  return {
    name: firm.name,
    slug: firm.slug,
    // 본사 소재지가 먼저다. firm.region 은 크롤러가 **공고의 근무 지역**을
    // 넣는 칸이라 '지역무관' 같은 값이 들어온다 — 법인이 어디 있는지와는
    // 다른 이야기다.
    region: shortRegion(firm.address) || (firm.region === "지역무관" ? null : firm.region),
    big4: /^(삼일|삼정|안진|한영)회계법인$/.test(firm.name),
    listed: !!firm.is_listed_auditor,
    years: rows.map((r) => r.fiscal_year),
    tr: rows.map((r) => r.trainee_count ?? 0),
    rev,
    cpa,
    pt: partners,
    trNow: last.trainee_count ?? 0,
    tr5: rows.reduce((s, r) => s + (r.trainee_count ?? 0), 0),
    perCpa: Math.round((rev / cpa) * 100) / 100,
    ptRatio: cpa ? Math.round((partners / cpa) * 100) : 0,
    growth: rows.length > 1 && first.revenue > 0
      ? Math.round((rev / Number(first.revenue) - 1) * 100) : null,
    // 부문 비중. 합이 0 이면 자료가 없는 것이라 null 로 둔다.
    audit: segSum > 0 ? Math.round((seg[0] / segSum) * 1000) / 10 : null,
    seg: segSum > 0 ? seg.map((v) => Math.round((v / segSum) * 1000) / 10) : null,
  };
}

const CSS = `
/* index.html 토큰에는 없는 값이라 여기서 정의한다.
   법인 페이지의 수습 그래프와 같은 색이다. */
:root { --mark: #8A5A19; }

.wrap { max-width: 1080px; margin: 0 auto; padding: 0 var(--pad-x) 64px; }
h1.ft { font-size: 21px; font-weight: 600; letter-spacing: -.02em; margin: 26px 0 5px; text-wrap: balance; }
p.ftsub { color: var(--ink-2); font-size: 12.5px; margin: 0 0 22px; max-width: 62ch; }

.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
  background: var(--line-2); border: 1px solid var(--line-2); margin-bottom: 22px; }
.tile { background: var(--bg); padding: 12px 14px; }
.tile .k { font-size: 10.5px; color: var(--ink-3); letter-spacing: .02em; }
.tile .v { font-size: 19px; font-weight: 600; letter-spacing: -.02em;
  font-variant-numeric: tabular-nums; margin-top: 2px; }
.tile .v em { font-size: 12px; font-weight: 400; font-style: normal; }
.tile .n { font-size: 10.5px; color: var(--ink-3); margin-top: 1px; }

.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-bottom: 12px; }
.seg { display: flex; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.seg button { font: inherit; font-size: 11.5px; border: 0; background: var(--bg);
  color: var(--ink-2); padding: 5px 11px; cursor: pointer; border-right: 1px solid var(--line); }
.seg button:last-child { border-right: 0; }
.seg button[aria-pressed="true"] { background: var(--accent); color: #fff; font-weight: 500; }
.toggle { font: inherit; font-size: 11.5px; padding: 5px 11px; cursor: pointer;
  border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink-2); }
.toggle[aria-pressed="true"] { background: var(--chip-pt-bg); border-color: #E8D5B8;
  color: var(--mark); font-weight: 500; }
#sortby { display: none; }
@media (max-width: 920px) { #sortby { display: inline-block; } }
#q, #region, #sortby { font: inherit; font-size: 12px; padding: 5px 10px;
  border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); }
#q { width: 140px; }
#q::placeholder { color: var(--ink-3); }
.seg button:focus-visible, .toggle:focus-visible, th button:focus-visible,
#q:focus-visible, #region:focus-visible, #sortby:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.count { margin-left: auto; font-size: 11.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }

/* 폰에서 그대로 들어가야 한다. 기본은 법인·수습·매출 세 칸이고,
   화면이 넓어지는 만큼 칸을 붙인다. 반대로 만들면(다 넣고 좁을 때 감추면)
   폰에서 옆으로 밀리는 표가 된다.
   여기서 감춘 값은 전부 법인 상세 페이지에 있다. */
.scroll { border-top: 1px solid var(--line); }
table.cmp { border-collapse: collapse; width: 100%; table-layout: auto; }
.t2, .t3, .t4 { display: none; }
@media (min-width: 560px) { .t2 { display: table-cell; } }
@media (min-width: 730px) { .t3 { display: table-cell; } }
@media (min-width: 920px) { .t4 { display: table-cell; } }
table.cmp thead th { position: sticky; top: 44px; z-index: 2; background: var(--bg);
  border-bottom: 1px solid var(--line); padding: 0; text-align: right;
  font-weight: 500; white-space: nowrap; }
table.cmp thead th:first-child { text-align: left; }
table.cmp th button { font: inherit; font-size: 10.5px; font-weight: 500; color: var(--ink-3);
  background: none; border: 0; cursor: pointer; padding: 9px 10px 8px; width: 100%;
  text-align: inherit; letter-spacing: .02em; white-space: nowrap; }
table.cmp th button:hover { color: var(--ink); }
table.cmp th[aria-sort] button { color: var(--ink); font-weight: 600; }
table.cmp th button .a { color: var(--accent); font-size: 9px; margin-left: 2px; }
table.cmp th.plain { font-size: 10.5px; color: var(--ink-3); padding: 9px 10px 8px;
  text-align: center; letter-spacing: .02em; }
table.cmp td { padding: 8px 10px; border-bottom: 1px solid var(--line-2); text-align: right;
  font-variant-numeric: tabular-nums; white-space: nowrap; }
@media (max-width: 519px) {
  table.cmp th button, table.cmp th.plain { padding-left: 4px; padding-right: 4px; }
  table.cmp td { padding-left: 4px; padding-right: 4px; }
  td.firm .rg { display: block; margin: 1px 0 0 34px; }
  .marks { gap: 2px; }
  .mk { width: 6px; }
}
table.cmp tbody tr:hover { background: var(--bg-subtle); }
td.firm { text-align: left; white-space: normal; }
/* inline-block 폭만으로는 글꼴에 따라 어긋난다. flex 로 자리를 고정한다. */
td.firm > .cell { display: flex; align-items: baseline; gap: 8px; }
td.firm .nm { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
td.firm a { color: var(--ink); text-decoration: none; font-weight: 500; }
td.firm a:hover { color: var(--accent); text-decoration: underline; }
/* 순위를 오른쪽으로 맞춰야 자릿수가 늘어도 법인명이 같은 자리에서 시작한다. */
td.firm .rank { color: var(--ink-3); font-size: 10.5px;
  font-variant-numeric: tabular-nums; flex: 0 0 26px; text-align: right; }
td.firm .rg { color: var(--ink-3); font-size: 10.5px; margin-left: 6px; }
td.firm .b4 { font-size: 9.5px; background: var(--chip-bg); color: var(--chip-fg);
  border-radius: 2px; padding: 1px 4px; margin-left: 6px; vertical-align: 1px; }
.muted { color: var(--ink-3); }
.pos { color: var(--positive); }

/* 부문 구성 — 검증 통과한 차트 팔레트를 그대로 쓴다 */
/* 폭을 %로 주면 gap 만큼 넘친다. flex-grow 로 나눠 gap 을 흡수시킨다. */
.mix { display: inline-flex; gap: 1px; width: 64px; height: 14px; vertical-align: -2px; }
.mix i { display: block; height: 100%; flex-basis: 0; min-width: 0; }

/* 수습 채용 이력. 뽑은 해는 채우고 안 뽑은 해는 테두리만 남긴다 —
   자료가 없는 것과 "그해엔 안 뽑았다"는 다르다. */
td.hist { text-align: center; }
.marks { display: inline-flex; gap: 3px; }
.mk { width: 8px; height: 15px; border-radius: 2px; background: transparent;
  border: 1px solid var(--line); display: block; }
.mk.on { background: var(--mark); border-color: var(--mark); }

.note { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line);
  font-size: 11.5px; color: var(--ink-3); line-height: 1.65; max-width: 68ch; }
.note b { color: var(--ink-2); font-weight: 500; }
.empty { padding: 40px 0; text-align: center; color: var(--ink-3); font-size: 12.5px; }

.mixcell { text-align: left; }
.mixcell .pct { margin-left: 7px; font-size: 11.5px; color: var(--ink-2); }

/* 좁은 화면에서는 부차적인 칸부터 접는다. 옆으로 밀어 보는 것보다
   중요한 칸만 남기고 한눈에 들어오는 편이 낫다. */
@media (max-width: 900px) {
  .opt { display: none; }
  table.cmp { min-width: 560px; }
}
@media (max-width: 620px) {
  .tiles { grid-template-columns: repeat(2, 1fr); }
  .count { margin-left: 0; width: 100%; }
}
`;

export function renderFirmsPage({ firms, financials }) {
  const byFirm = new Map();
  for (const f of financials) {
    if (!byFirm.has(f.firm_id)) byFirm.set(f.firm_id, []);
    byFirm.get(f.firm_id).push(f);
  }

  const rows = firms
    .map((f) => toRow(f, byFirm.get(f.id) || []))
    .filter(Boolean)
    .sort((a, b) => b.rev - a.rev);

  const hiring = rows.filter((r) => r.tr5 > 0).length;
  // 수습 채용 합계는 빅4 가 여덟 할을 차지한다. 한 덩어리로 보여주면
  // 로컬이 그만큼 뽑는 것처럼 읽힌다.
  const big4Tr = rows.filter((r) => r.big4).reduce((s, r) => s + r.tr5, 0);
  const local = rows.reduce((s, r) => s + r.tr5, 0) - big4Tr;
  const years = rows.reduce((s, r) => s + r.years.length, 0);
  const sorted = rows.map((r) => r.rev).sort((a, b) => a - b);
  const median = Math.round(sorted[Math.floor(sorted.length / 2)] || 0);

  const regions = [...new Set(rows.map((r) => r.region).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "ko"));

  const data = JSON.stringify(rows).replace(/<\/script/gi, "<\\/script");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>회계법인 ${rows.length}곳 비교 — 매출·회계사 수·수습 채용 | CPAPING</title>
<meta name="description" content="국내 회계법인 ${rows.length}곳의 매출, 회계사 수, 수습회계사 채용 이력을 사업보고서 기준으로 정리했습니다. 매출·성장률·1인당 매출로 정렬할 수 있습니다.">
<link rel="canonical" href="https://cpaping.com/firms">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CPAPING">
<meta property="og:url" content="https://cpaping.com/firms">
<meta property="og:title" content="회계법인 ${rows.length}곳 비교 — CPAPING">
<meta property="og:description" content="매출, 회계사 수, 수습회계사 채용 이력을 사업보고서 기준으로 정리했습니다.">
<meta property="og:image" content="https://cpaping.com/og.png">
<meta property="og:locale" content="ko_KR">
<meta name="theme-color" content="#123A8A">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap">
<style>__BASE__${CSS}</style>
</head>
<body>
<div class="shell">
  <header class="topbar">
    <div class="wordmark">CPAPING</div>
    <nav class="tabs" aria-label="주요 화면">
      <a href="/">공고</a>
      <a href="/firms" aria-current="page">법인</a>
    </nav>
    <div class="status"><span class="dot" aria-hidden="true"></span>10분마다 확인 중</div>
  </header>

  <div class="wrap">
    <h1 class="ft">회계법인 ${rows.length}곳</h1>
    <p class="ftsub">금융감독원에 제출된 회계법인 사업보고서에서 뽑았습니다.
      수습회계사를 몇 명 뽑았는지, 매출과 인원이 어떻게 움직였는지를 나란히 놓고 볼 수 있습니다.</p>

    <div class="tiles">
      <div class="tile"><div class="k">법인</div><div class="v">${rows.length}</div><div class="n">사업연도 ${years.toLocaleString("ko-KR")}개</div></div>
      <div class="tile"><div class="k">수습을 뽑은 곳</div><div class="v">${hiring}</div><div class="n">5년 내 1명 이상</div></div>
      <div class="tile"><div class="k">5년간 수습 채용</div><div class="v">${local.toLocaleString("ko-KR")}<em>명</em></div><div class="n">빅4 ${big4Tr.toLocaleString("ko-KR")}명 제외</div></div>
      <div class="tile"><div class="k">매출 중앙값</div><div class="v">${median}<em>억</em></div><div class="n">최근 사업연도</div></div>
    </div>

    <div class="filters">
      <button class="toggle" id="onlyHiring" aria-pressed="false">수습 뽑는 곳만</button>
      <div class="seg" role="group" aria-label="매출 규모">
        <button data-min="0" aria-pressed="true">전체</button>
        <button data-min="50" aria-pressed="false">50억+</button>
        <button data-min="100" aria-pressed="false">100억+</button>
        <button data-min="300" aria-pressed="false">300억+</button>
      </div>
      <select id="region" aria-label="지역">
        <option value="">지역 전체</option>
        ${regions.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("")}
      </select>
      <input id="q" type="search" placeholder="법인 이름" aria-label="법인 이름으로 찾기">
      <select id="sortby" aria-label="정렬 기준">
        <option value="rev">매출순</option>
        <option value="tr5">5년 수습순</option>
        <option value="trNow">최근 수습순</option>
        <option value="cpa">회계사순</option>
        <option value="growth">성장순</option>
        <option value="audit">감사 비중순</option>
      </select>
      <span class="count" id="count"></span>
    </div>

    <div class="scroll">
      <table class="cmp">
        <thead>
          <tr>
            <th data-k="name"><button>법인</button></th>
            <th class="plain">수습</th>
            <th data-k="rev"><button>매출</button></th>
            <th data-k="cpa" class="t2"><button>회계사</button></th>
            <th data-k="growth" class="t3"><button>성장</button></th>
            <th data-k="audit" class="t4"><button>부문 구성 · 감사</button></th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <div class="empty" id="empty" hidden>조건에 맞는 법인이 없습니다.</div>

    <p class="note">
      <b>수습 채용 이력</b>은 왼쪽이 오래된 해입니다. 채워진 칸은 그해에 수습회계사를 뽑았다는 뜻이고,
      빈 칸은 뽑지 않은 해입니다. 칸이 다섯 개보다 적은 곳은 설립한 지 얼마 안 돼 사업보고서가 그만큼만 있는 법인입니다.<br>
      <b>부문 구성</b>은 감사·세무·딜자문·기타 순입니다. <b>1인당 매출</b>은 매출을 회계사 수로 나눈 값이고,
      <b>파트너 비율</b>은 회계사 중 사원(파트너)이 차지하는 몫입니다.<br>
      수치는 각 법인이 금융감독원에 낸 사업보고서 기준입니다. 잘못된 내용이 있으면
      <a href="mailto:contact@cpaping.com">contact@cpaping.com</a> 으로 알려주세요.
    </p>
  </div>
</div>

<script id="firm-data" type="application/json">${data}</script>
<script>
const FIRMS = JSON.parse(document.getElementById("firm-data").textContent);
const SEG = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

let sortKey = "rev", sortDir = -1;
let onlyHiring = false, minRev = 0, region = "", query = "";

const rowsEl = document.getElementById("rows");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const num = n => n.toLocaleString("ko-KR");

function marks(f) {
  return f.tr.map((v, i) =>
    '<span class="mk' + (v > 0 ? " on" : "") + '" title="' +
    esc(f.years[i]) + " " + v + '명"></span>').join("");
}

function mix(f) {
  if (!f.seg) return '<span class="muted">–</span>';
  return '<span class="mix">' + f.seg.map((v, i) =>
    v > 0 ? '<i style="flex:' + v + ';background:' + SEG[i] + '"></i>' : "").join("") + "</span>";
}

function render() {
  const q = query.trim();
  const list = FIRMS.filter(f =>
    (!onlyHiring || f.tr5 > 0) && f.rev >= minRev &&
    (!region || f.region === region) && (!q || f.name.includes(q)));

  list.sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name, "ko") * -sortDir;
    const av = a[sortKey], bv = b[sortKey];
    if (av === null) return 1;
    if (bv === null) return -1;
    // 값이 같으면 매출로 가른다. 눌러도 순서가 흔들리지 않게 한다.
    return (av - bv) * sortDir || (b.rev - a.rev);
  });

  countEl.textContent = list.length + "곳";
  emptyEl.hidden = list.length > 0;

  rowsEl.innerHTML = list.map((f, i) => {
    const g = f.growth;
    return '<tr>' +
      '<td class="firm"><div class="cell"><span class="rank">' + (i + 1) + '</span>' +
        '<span class="nm"><a href="/firm/' + encodeURIComponent(f.slug) + '">' + esc(f.name) + '</a>' +
        (f.big4 ? '<span class="b4">빅4</span>' : "") +
        (f.region ? '<span class="rg">' + esc(f.region) + '</span>' : "") + '</span></div></td>' +
      '<td class="hist"><span class="marks">' + marks(f) + '</span></td>' +
      '<td>' + num(Math.round(f.rev)) + '억</td>' +
      '<td class="t2">' + f.cpa + '명</td>' +
      '<td class="t3">' + (g === null ? '<span class="muted">–</span>'
        : '<span class="' + (g > 0 ? "pos" : "muted") + '">' + (g > 0 ? "+" : "") + g + '%</span>') + '</td>' +
      '<td class="t4 mixcell">' + mix(f) +
        (f.audit === null ? '' : '<span class="pct">' + f.audit + '%</span>') + '</td>' +
    '</tr>';
  }).join("");

  document.querySelectorAll("table.cmp thead th[data-k]").forEach(th => {
    const on = th.dataset.k === sortKey;
    if (on) th.setAttribute("aria-sort", sortDir < 0 ? "descending" : "ascending");
    else th.removeAttribute("aria-sort");
    const b = th.querySelector("button");
    b.innerHTML = b.textContent.replace(/[▾▴]\\s*$/, "").trim() +
      (on ? ' <span class="a">' + (sortDir < 0 ? "▾" : "▴") + "</span>" : "");
  });
}

document.querySelectorAll("table.cmp thead th[data-k] button").forEach(b => {
  b.addEventListener("click", () => {
    const k = b.parentElement.dataset.k;
    if (k === sortKey) sortDir = -sortDir;
    else { sortKey = k; sortDir = k === "name" ? 1 : -1; }
    render();
  });
});
document.getElementById("onlyHiring").addEventListener("click", e => {
  onlyHiring = !onlyHiring;
  e.currentTarget.setAttribute("aria-pressed", String(onlyHiring));
  render();
});
document.querySelectorAll(".seg button").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true");
    minRev = Number(b.dataset.min);
    render();
  });
});
document.getElementById("region").addEventListener("change", e => { region = e.target.value; render(); });
// 좁은 화면에서는 머리글이 감춰지므로 정렬을 고를 다른 길이 있어야 한다.
document.getElementById("sortby").addEventListener("change", e => {
  sortKey = e.target.value; sortDir = -1; render();
});
document.getElementById("q").addEventListener("input", e => { query = e.target.value; render(); });

render();
</script>
</body>
</html>`;
}
