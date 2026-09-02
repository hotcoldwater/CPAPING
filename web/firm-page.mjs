/**
 * 법인 상세 페이지를 빌드할 때 정적으로 찍어낸다.
 *
 * 클라이언트에서 그리면 검색엔진이 못 읽는다. 이 페이지의 목적 중 하나가
 * "OO회계법인 규모" 같은 검색으로 사람이 들어오게 하는 것이라 정적이어야 한다.
 *
 * 자료가 없는 법인이 대부분이다. 없는 항목은 "자료 없음" 을 늘어놓지 않고
 * 섹션째 뺀다. 빈 표가 늘어선 화면보다 짧고 완결된 화면이 낫다.
 */

import { SERIES, stackedBars, legend, shareBar, traineeHistory, dataTable, CHART_CSS }
  from "./charts.mjs";

const SITE = "https://cpaping.com";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const num = (v) => (v === null || v === undefined ? null : Number(v));
const fmt = (v, digits = 1) =>
  v === null ? "—" : Number(v).toLocaleString("ko-KR", { maximumFractionDigits: digits });

/** '2025.08' → '2025' */
const yearOf = (fiscal) => String(fiscal || "").slice(0, 4);

/** 'YYYY-MM-DD' → 'MM.DD' */
const shortDate = (iso) => (iso ? iso.slice(5).replace("-", ".") : "");

/**
 * 제목 앞머리의 법인명을 지운다.
 * 법인 페이지에서는 이미 법인명이 제목으로 크게 붙어 있어 더 불필요하다.
 * "[동성회계법인] 수습 회계사 채용" → "수습 회계사 채용"
 */
function trimTitle(title, firmName) {
  let out = String(title || "").trim();
  const head = out.match(/^[[(【]([^\])】]{1,30})[\])】]\s*/);
  const bare = String(firmName || "").replace(/\s|\(.*\)/g, "");
  if (head && bare.length >= 3) {
    const inner = head[1].replace(/\s/g, "");
    if (inner.includes(bare) || inner.includes(bare.slice(0, 3))) {
      out = out.slice(head[0].length);
    }
  }
  return out.replace(/^[-—·\s]+/, "").replace(/-{2,}/g, " — ").trim() || title;
}

function daysLeft(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

// ---------------------------------------------------------------------------
// 조각들
// ---------------------------------------------------------------------------

function statTiles(firm, latest, first, prev) {
  const tiles = [];

  if (latest?.revenue != null) {
    tiles.push({ label: "매출액", value: fmt(latest.revenue, 2), unit: "억",
                 note: `${yearOf(latest.fiscal_year)}년 기준` });
  }
  if (latest?.revenue != null && first?.revenue != null && first !== latest) {
    const growth = (latest.revenue / first.revenue - 1) * 100;
    // 첫 해 대비 늘었어도 최근에 꺾였으면 초록으로 칠하지 않는다.
    // 정점을 찍고 3년째 줄어드는 법인을 "성장" 으로 보이게 하면 안 된다.
    const rising = latest.revenue >= (prev?.revenue ?? 0);
    tiles.push({ label: `${yearOf(first.fiscal_year)}년 대비`,
                 value: `${growth >= 0 ? "+" : ""}${Math.round(growth)}%`, unit: "",
                 note: "매출 변화", positive: growth >= 0 && rising });
  }
  if (latest?.cpa_count != null) {
    tiles.push({ label: "회계사 수", value: fmt(latest.cpa_count, 0), unit: "명",
                 note: latest.partner_count != null
                   ? `파트너 ${latest.partner_count}명 포함` : "" });
  }
  // 지원자가 가장 먼저 보는 값이라 위에 둔다. 5 년 합계가 아니라 최근 한
  // 해를 쓴다 — 3 년 전에 스무 명 뽑고 이후 안 뽑은 곳과 올해 뽑은 곳이
  // 합계로는 같아 보인다.
  if (latest?.trainee_count != null) {
    tiles.push({ label: "수습 채용", value: fmt(latest.trainee_count, 0), unit: "명",
                 note: `${yearOf(latest.fiscal_year)}년 기준`,
                 positive: latest.trainee_count > 0 });
  }
  if (latest?.revenue != null && latest?.cpa_count) {
    tiles.push({ label: "1인당 매출", value: fmt(latest.revenue / latest.cpa_count, 1),
                 unit: "억", note: "매출 ÷ 회계사 수" });
  }

  if (!tiles.length) return "";
  return `<section class="tiles">${tiles.map((t) => `
    <div class="tile">
      <div class="t-label">${esc(t.label)}</div>
      <div class="t-value${t.positive ? " up" : ""}">${esc(t.value)}<small>${esc(t.unit)}</small></div>
      ${t.note ? `<div class="t-note">${esc(t.note)}</div>` : ""}
    </div>`).join("")}</section>`;
}

function revenueSection(fin) {
  const withRevenue = fin.filter((f) => f.revenue != null);
  if (withRevenue.length < 2) return "";

  const keys = ["audit", "tax", "deal", "other"];
  const rows = withRevenue.map((f) => ({
    label: yearOf(f.fiscal_year),
    total: Number(f.revenue),
    segments: [
      { key: "audit", value: num(f.revenue_audit) || 0 },
      { key: "tax", value: num(f.revenue_tax) || 0 },
      { key: "deal", value: num(f.revenue_deal) || 0 },
      { key: "other", value: num(f.revenue_other) || 0 },
    ],
  }));

  const table = dataTable(
    ["연도", "감사", "세무", "딜", "기타", "합계"],
    withRevenue.map((f) => [
      yearOf(f.fiscal_year), fmt(num(f.revenue_audit), 2), fmt(num(f.revenue_tax), 2),
      fmt(num(f.revenue_deal), 2), fmt(num(f.revenue_other), 2), fmt(num(f.revenue), 2),
    ]));

  return `
  <section>
    <div class="sec-head"><h2>매출 추이</h2><span class="unit">단위: 억원</span></div>
    ${legend(keys, SERIES)}
    <div class="chart">${stackedBars({ rows, series: SERIES, unit: "억",
                                       totalLabel: (t) => fmt(t, 1) })}</div>
    ${revenueCaption(withRevenue)}
    <details class="table-toggle"><summary>표로 보기</summary>${table}</details>
  </section>`;
}

/**
 * 매출 흐름을 한 줄로 요약한다.
 *
 * 막대만 보고 흐름을 읽지 못하는 사람도 있고, 정점을 찍고 줄어드는 경우가
 * 특히 눈에 잘 안 띈다. 숫자로 못 박아 둔다.
 */
function revenueCaption(rows) {
  if (rows.length < 3) return "";
  const peak = rows.reduce((a, b) => (Number(b.revenue) > Number(a.revenue) ? b : a));
  const last = rows[rows.length - 1];
  const first = rows[0];

  let text;
  if (peak !== last && Number(last.revenue) < Number(peak.revenue) * 0.97) {
    const drop = (1 - Number(last.revenue) / Number(peak.revenue)) * 100;
    text = `${yearOf(peak.fiscal_year)}년 ${fmt(peak.revenue, 1)}억으로 가장 높았고, ` +
           `이후 ${Math.round(drop)}% 줄었습니다.`;
  } else if (Number(last.revenue) > Number(first.revenue)) {
    text = `${yearOf(first.fiscal_year)}년 이후 꾸준히 늘었습니다.`;
  } else {
    return "";
  }
  return `<p class="caption">${esc(text)}</p>`;
}

function shareSection(latest) {
  if (!latest || latest.revenue == null) return "";
  const segments = [
    { key: "audit", value: num(latest.revenue_audit) || 0 },
    { key: "tax", value: num(latest.revenue_tax) || 0 },
    { key: "deal", value: num(latest.revenue_deal) || 0 },
    { key: "other", value: num(latest.revenue_other) || 0 },
  ];
  if (!segments.some((s) => s.value > 0)) return "";

  const top = [...segments].sort((a, b) => b.value - a.value)[0];
  return `
  <section>
    <div class="sec-head"><h2>부문 구성</h2>
      <span class="unit">${esc(yearOf(latest.fiscal_year))}년</span></div>
    ${shareBar(segments, SERIES)}
    <p class="caption">${esc(SERIES[top.key].label)} 부문 비중이 가장 큽니다.</p>
  </section>`;
}

function headcountSection(fin) {
  const rows = fin.filter((f) => f.cpa_count != null);
  if (rows.length < 2) return "";

  // 파트너는 회계사에 포함된다. 나란히 그리면 인원이 두 배로 보인다.
  const series = {
    partner: { label: "파트너", color: SERIES.audit.color },
    staff: { label: "그 외 회계사", color: SERIES.deal.color },
  };
  const bars = rows.map((f) => {
    const total = Number(f.cpa_count);
    const partner = Math.min(num(f.partner_count) || 0, total);
    return {
      label: yearOf(f.fiscal_year), total,
      segments: [{ key: "partner", value: partner },
                 { key: "staff", value: total - partner }],
    };
  });

  return `
  <section>
    <div class="sec-head"><h2>인력 추이</h2><span class="unit">단위: 명</span></div>
    ${legend(["partner", "staff"], series)}
    <div class="chart">${stackedBars({ rows: bars, series, unit: "명",
                                       totalLabel: (t) => fmt(t, 0) })}</div>
    <p class="caption">파트너는 회계사 수에 포함된 값입니다.</p>
  </section>`;
}

/**
 * 로컬 회계법인 안에서 몇 번째인가.
 *
 * "매출 176억" 은 그 자체로는 큰지 작은지 알 수 없다. 몇 곳 중 몇 번째인지가
 * 있어야 뜻이 생긴다. 빅4 는 자릿수가 달라 같이 세면 로컬끼리의 차이가
 * 뭉개지므로 빼고 센다.
 */
function rankBar(label, rank, total, value, unit) {
  if (!rank || !total) return "";
  // 1 위가 왼쪽 끝. 막대는 "위에서 얼마나 왔는가" 를 채운다.
  const pos = ((total - rank) / (total - 1 || 1)) * 100;
  const topPct = Math.round((rank / total) * 100);
  return `
    <div class="rank">
      <div class="rank-head">
        <span class="rank-label">${esc(label)}</span>
        <span class="rank-val"><b>${esc(rank)}위</b> / ${esc(total)}곳
          <span class="rank-top">상위 ${topPct}%</span></span>
      </div>
      <div class="rank-track">
        <div class="rank-fill" style="width:${pos.toFixed(1)}%"></div>
        <div class="rank-mark" style="left:${pos.toFixed(1)}%"></div>
      </div>
      <div class="rank-ends"><span>${esc(total)}위</span><span>${esc(value)}${esc(unit)}</span><span>1위</span></div>
    </div>`;
}

function rankSection(ranks) {
  if (!ranks || (!ranks.revenue && !ranks.audit)) return "";
  const bars = [
    ranks.revenue ? rankBar("매출액", ranks.revenue.rank, ranks.revenue.total,
                            ranks.revenue.value, "억") : "",
    ranks.audit ? rankBar("감사부문 매출", ranks.audit.rank, ranks.audit.total,
                          ranks.audit.value, "억") : "",
  ].join("");
  return `
  <section>
    <div class="sec-head"><h2>로컬 회계법인 중 위치</h2><span class="unit">빅4 제외</span></div>
    ${bars}
    <p class="caption">사업보고서를 낸 로컬 회계법인끼리 견준 순위입니다.</p>
  </section>`;
}

function traineeSection(fin) {
  const rows = fin.filter((f) => f.trainee_count != null);
  if (!rows.length) return "";

  const data = rows.map((f) => ({ label: yearOf(f.fiscal_year),
                                  value: Number(f.trainee_count) }));
  const hired = data.filter((d) => d.value > 0);
  // 연도별 인원은 바로 위 그래프가 이미 말하고 있다. 같은 내용을 문장으로
  // 되풀이하지 않고 그래프가 못 하는 것 — 합계 — 만 적는다.
  const total = hired.reduce((s, d) => s + d.value, 0);
  const caption = hired.length
    ? `최근 ${data.length}년간 모두 ${total}명을 채용했습니다.`
    : `최근 ${data.length}년간 수습회계사 채용 기록이 없습니다.`;

  return `
  <section class="trainee-sec">
    <div class="sec-head"><h2>수습회계사 채용</h2><span class="unit">사업보고서 기준</span></div>
    ${traineeHistory(data)}
    <p class="caption strong">${esc(caption)}</p>
  </section>`;
}

function postingsSection(postings, firmName) {
  if (!postings.length) return "";
  const rows = postings.map((p) => {
    const left = daysLeft(p.deadline);
    const closed = p.removed_at || (left !== null && left < 0);
    const due = closed ? "종료" : left === 0 ? "오늘 마감" : `D-${left}`;
    return `<a class="row${closed ? " closed" : left <= 7 ? " soon" : ""}"
      href="${esc(p.detail_url)}" target="_blank" rel="noopener">
      <div>
        <div class="firm">${esc(shortDate(p.posted_at))} 등록</div>
        <div class="title">${esc(trimTitle(p.title, firmName))}</div>
        <div class="chips">
          ${p.region ? `<span class="chip">${esc(p.region)}</span>` : ""}
          <span class="chip${p.employment_type === "Part Time" ? " pt" : ""}">${
            p.employment_type === "Part Time" ? "파트타임" : "정규직"}</span>
        </div>
      </div>
      <div class="due"><span class="dday">${esc(due)}</span>
        <small class="date">${esc(shortDate(p.deadline))}</small></div>
    </a>`;
  }).join("");

  return `
  <section>
    <div class="sec-head"><h2>이 법인의 공고</h2>
      <span class="unit">${postings.length}건</span></div>
    <div class="rows">${rows}</div>
  </section>`;
}

function profileSection(firm, latest) {
  const items = [
    ["대표이사", firm.ceo],
    ["본사 소재지", firm.address],
    ["상장회사 감사인", firm.is_listed_auditor === null || firm.is_listed_auditor === undefined
      ? null
      : firm.is_listed_auditor
        ? `등록${firm.auditor_reg_no ? ` (${firm.auditor_reg_no})` : ""}`
        : "미등록"],
    ["소속 회계사", latest?.cpa_count != null
      ? `${latest.cpa_count}명${latest.partner_count != null
          ? ` (파트너 ${latest.partner_count}명)` : ""}` : null],
    ["자료 기준", latest?.fiscal_year
      ? `${latest.fiscal_year} ${firm.data_source || "사업보고서"}` : null],
  ].filter(([, v]) => v);

  if (!items.length) return "";
  return `
  <section>
    <div class="sec-head"><h2>기본 정보</h2></div>
    <dl class="profile">${items.map(([k, v]) =>
      `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
  </section>`;
}

// ---------------------------------------------------------------------------

export function renderFirmPage({ firm, financials, postings, ranks }) {
  // 오래된 해부터 정렬해 시간 흐름대로 읽히게 한다
  const fin = [...financials].sort((a, b) =>
    String(a.fiscal_year).localeCompare(String(b.fiscal_year)));
  const latest = fin[fin.length - 1] || null;
  const first = fin[0] || null;
  const hasData = fin.length > 0;

  const chips = [
    firm.region ? { text: firm.region } : null,
    latest?.cpa_count != null ? { text: `회계사 ${latest.cpa_count}명` } : null,
    firm.is_listed_auditor ? { text: "상장회사 감사인" } : null,
  ].filter(Boolean);

  const title = `${firm.name} — 규모·채용 정보 | CPAPING`;
  const description = latest?.revenue != null
    ? `${firm.name}의 매출 ${fmt(latest.revenue, 0)}억원, 회계사 ${latest.cpa_count ?? "-"}명. ` +
      `수습회계사 채용 이력과 최근 공고를 정리했습니다.`
    : `${firm.name}의 수습회계사 채용 공고와 채용 이력을 정리했습니다.`;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}/firm/${encodeURIComponent(firm.slug)}">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#123A8A">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(firm.name)} — 규모·채용 정보">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:url" content="${SITE}/firm/${encodeURIComponent(firm.slug)}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap">
<style>
:root {
  --ink:#101317; --ink-2:#5B6472; --ink-3:#868D99;
  --line:#E4E6EA; --line-2:#EDEFF2;
  --bg:#FFFFFF; --bg-subtle:#FBFBFC; --bg-hover:#F7F9FC;
  --accent:#123A8A; --urgent:#B4341F; --up:#17A05F;
  --chip-bg:#EEF1F6; --chip-fg:#4A5462;
  --chip-pt-bg:#FBF0E4; --chip-pt-fg:#8A5A19;
  --radius:4px; --pad-x:18px;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg-subtle);color:var(--ink);
  font-family:'IBM Plex Sans KR',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;
  font-size:14px;line-height:1.7;-webkit-font-smoothing:antialiased}
.shell{max-width:720px;margin:0 auto;min-height:100vh;background:var(--bg);
  border-inline:1px solid var(--line);display:flex;flex-direction:column}
@media(max-width:720px){.shell{border-inline:0}}

.topbar{display:flex;align-items:center;justify-content:space-between;height:44px;
  padding:0 var(--pad-x);background:var(--bg-subtle);border-bottom:1px solid var(--line);
  position:sticky;top:0;z-index:10}
.topbar a{color:inherit;text-decoration:none}
.wordmark{font-size:13.5px;font-weight:600;letter-spacing:-.01em}
.back{font-size:12px;color:var(--ink-2)}
.back:hover{color:var(--ink)}

.head{padding:24px var(--pad-x) 20px;border-bottom:1px solid var(--line)}
.head h1{margin:0 0 8px;font-size:22px;font-weight:600;letter-spacing:-.02em}
.head .chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
.head .addr{font-size:12px;color:var(--ink-3);margin:0}
.head .site{font-size:12px;color:var(--accent);text-decoration:none;white-space:nowrap}
.head .site:hover{text-decoration:underline}
.head .top-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}

.chip{font-size:10.5px;line-height:1.5;padding:1.5px 7px;border-radius:3px;
  background:var(--chip-bg);color:var(--chip-fg)}
.chip.hi{background:var(--chip-pt-bg);color:var(--chip-pt-fg)}
.chip.pt{background:var(--chip-pt-bg);color:var(--chip-pt-fg)}

.tiles{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line);
  background:var(--bg-subtle)}
@media(max-width:560px){.tiles{grid-template-columns:repeat(2,1fr)}}
.tile{padding:14px var(--pad-x);border-right:1px solid var(--line-2)}
.tile:last-child{border-right:0}
@media(max-width:560px){
  .tile:nth-child(2n){border-right:0}
  .tile:nth-child(-n+2){border-bottom:1px solid var(--line-2)}
}
.t-label{font-size:11px;color:var(--ink-3)}
.t-value{font-size:20px;font-weight:600;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;margin-top:2px}
.t-value.up{color:var(--up)}
.t-value small{font-size:13px;font-weight:500;margin-left:1px}
.t-note{font-size:11px;color:var(--ink-3);margin-top:1px}

main{padding:4px var(--pad-x) 32px;display:flex;flex-direction:column}
section{padding:22px 0;border-bottom:1px solid var(--line-2)}
section:last-of-type{border-bottom:0}
.sec-head{display:flex;align-items:baseline;justify-content:space-between;
  gap:10px;margin-bottom:12px}
.sec-head h2{margin:0;font-size:14px;font-weight:600;letter-spacing:-.01em}
.sec-head .unit{font-size:11.5px;color:var(--ink-3)}
.rank{margin:16px 0 0}
.rank+.rank{margin-top:20px}
.rank-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:7px}
.rank-label{font-size:12.5px;color:var(--ink-2)}
.rank-val{font-size:12.5px;color:var(--ink-2);font-variant-numeric:tabular-nums}
.rank-val b{font-size:15px;color:var(--ink);font-weight:600}
.rank-top{margin-left:7px;font-size:11px;background:var(--chip-bg);color:var(--chip-fg);border-radius:2px;padding:1px 5px}
.rank-track{position:relative;height:10px;background:var(--line-2);border-radius:2px}
.rank-fill{position:absolute;left:0;top:0;bottom:0;background:var(--accent);opacity:.16;border-radius:2px}
.rank-mark{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--accent);border-radius:1px;transform:translateX(-1px)}
.rank-ends{display:flex;justify-content:space-between;margin-top:5px;font-size:10.5px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.rank-ends span:nth-child(2){color:var(--ink-2)}
.caption{margin:10px 0 0;font-size:12.5px;color:var(--ink-2)}
.caption.strong{color:var(--ink);font-weight:500}
.trainee-sec{background:var(--bg-subtle);margin-inline:calc(var(--pad-x)*-1);
  padding-inline:var(--pad-x);border-top:1px solid var(--line-2)}

.table-toggle{margin-top:12px}
.table-toggle summary{font-size:11.5px;color:var(--ink-2);cursor:pointer;
  list-style:none;display:inline-flex;align-items:center;gap:4px}
.table-toggle summary::-webkit-details-marker{display:none}
.table-toggle summary::before{content:"▸";font-size:9px;color:var(--ink-3)}
.table-toggle[open] summary::before{content:"▾"}
.table-toggle summary:hover{color:var(--ink)}
.scroll{overflow-x:auto;margin-top:10px}

.rows{display:flex;flex-direction:column}
.row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;
  padding:12px 0;border-bottom:1px solid var(--line-2);color:inherit;text-decoration:none}
.row:last-child{border-bottom:0}
.row:hover{background:var(--bg-hover)}
.row .firm{font-size:11.5px;color:var(--ink-2)}
.row .title{font-size:13.5px;font-weight:500;line-height:1.45;margin-top:2px;letter-spacing:-.01em}
.row .chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.row .due{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.row .dday{font-size:12px;font-weight:500}
.row .date{display:block;font-size:10.5px;color:var(--ink-3)}
.row.soon .dday{color:var(--urgent)}
.row.closed{opacity:.6}
.row.closed .dday{color:var(--ink-3);font-weight:400}

.profile{display:grid;grid-template-columns:auto 1fr;gap:0;margin:0;font-size:13px}
.profile dt{color:var(--ink-2);padding:9px 18px 9px 0;border-bottom:1px solid var(--line-2);
  white-space:nowrap}
.profile dd{margin:0;padding:9px 0;border-bottom:1px solid var(--line-2)}
.profile dt:last-of-type,.profile dd:last-of-type{border-bottom:0}

.nodata{padding:22px 0;font-size:13px;color:var(--ink-2)}

footer{margin-top:auto;padding:18px var(--pad-x);background:var(--bg-subtle);
  border-top:1px solid var(--line);font-size:11.5px;color:var(--ink-3);line-height:1.7}
footer a{color:var(--ink-2)}
footer .links{margin-top:8px;text-align:center}
footer .sep{margin:0 7px;opacity:.5}
${CHART_CSS}
</style>
</head>
<body>
<div class="shell">

  <header class="topbar">
    <a class="wordmark" href="/">CPAPING</a>
    <a class="back" href="/">← 공고 목록</a>
  </header>

  <div class="head">
    <div class="top-row">
      <h1>${esc(firm.name)}</h1>
      ${firm.homepage ? `<a class="site" href="${esc(firm.homepage)}" target="_blank"
        rel="noopener nofollow">홈페이지 ↗</a>` : ""}
    </div>
    ${chips.length ? `<div class="chips">${chips.map((c) =>
      `<span class="chip${c.hi ? " hi" : ""}">${esc(c.text)}</span>`).join("")}</div>` : ""}
    ${firm.address ? `<p class="addr">${esc(firm.address)}</p>` : ""}
  </div>

  ${statTiles(firm, latest, first, fin[fin.length - 2] || null)}

  <main>
    ${revenueSection(fin)}
    ${shareSection(latest)}
    ${rankSection(ranks)}
    ${headcountSection(fin)}
    ${traineeSection(fin)}
    ${postingsSection(postings, firm.name)}
    ${profileSection(firm, latest)}
    ${!hasData ? `<p class="nodata">재무 정보는 준비 중입니다.</p>` : ""}
  </main>

  <footer>
    ${hasData
      ? "재무·인력 정보는 회계법인 사업보고서 기준입니다."
      : "채용 공고는 한국공인회계사회 게시판에서 수집합니다."}
    잘못된 내용이 있으면 <a href="mailto:contact@cpaping.com?subject=${
      encodeURIComponent(firm.name + " 정보 정정 요청")}">contact@cpaping.com</a>
    으로 알려주세요.
    <div class="links">
      <a href="/">공고 목록</a><span class="sep">·</span><a href="/privacy">개인정보처리방침</a>
    </div>
  </footer>

</div>
</body>
</html>
`;
}
