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
    // 폰에서는 소수점을 뗀다. '11,093.66억' 은 177px 칸에 들어가지 않는다.
    tiles.push({ label: "매출액", value: fmt(latest.revenue, 2), unit: "억",
                 short: fmt(Math.round(latest.revenue), 0),
                 note: `${yearOf(latest.fiscal_year)}년 기준` });
  }
  // 5 년 성장률은 정점을 찍고 3 년째 줄어드는 법인도 "성장" 으로 보이게 한다.
  // 지금 어떤지가 궁금한 값이라 바로 앞 사업연도와 견준다.
  if (latest?.revenue != null && prev?.revenue) {
    const growth = (latest.revenue / prev.revenue - 1) * 100;
    tiles.push({ label: `${yearOf(prev.fiscal_year)}년 대비`,
                 value: `${growth >= 0 ? "+" : ""}${Math.round(growth)}%`, unit: "",
                 note: "매출 변화", positive: growth >= 0 });
  }
  if (latest?.cpa_count != null) {
    tiles.push({ label: "회계사 수", value: fmt(latest.cpa_count, 0), unit: "명",
                 note: latest.partner_count != null
                   ? `파트너 ${latest.partner_count}명 포함` : "" });
  }
  // 지원자가 가장 먼저 보는 값이라 위에 둔다. 5 년 합계가 아니라 최근 한
  // 해를 쓴다 — 3 년 전에 스무 명 뽑고 이후 안 뽑은 곳과 올해 뽑은 곳이
  // 합계로는 같아 보인다.
  //
  // '채용' 이 아니라 '수' 다. 인력총괄표의 수습 칸은 결산일에 아직 공인회계사
  // 등록을 못 한 사람만 센다. 삼일 보고서 각주가 분명히 한다 — 등록을 마친
  // 2,512 명 중에도 실무수습 중인 사람이 271 명이고 그들은 이 칸에 없다.
  // 그래서 연간 채용 인원보다 구조적으로 적게 나온다.
  if (latest?.trainee_count != null) {
    tiles.push({ label: "수습회계사", value: fmt(latest.trainee_count, 0), unit: "명",
                 note: `${yearOf(latest.fiscal_year)}년 결산 기준`,
                 positive: latest.trainee_count > 0 });
  }
  if (latest?.revenue != null && latest?.cpa_count) {
    // 폰에서는 감춘다. 다섯 칸을 2열에 넣으면 한 칸이 혼자 남는다.
    tiles.push({ label: "1인당 매출", value: fmt(latest.revenue / latest.cpa_count, 1),
                 unit: "억", note: "매출 ÷ 회계사 수", opt: true });
  }

  if (!tiles.length) return "";
  return `<section class="tiles">${tiles.map((t) => `
    <div class="tile${t.opt ? " opt" : ""}">
      <div class="t-label">${esc(t.label)}</div>
      <div class="t-value${t.positive ? " up" : ""}">${
        t.short ? `<span class="wide">${esc(t.value)}</span><span class="narrow">${esc(t.short)}</span>`
                : esc(t.value)}<small>${esc(t.unit)}</small></div>
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

/**
 * 상장사 감사 고객.
 *
 * 회계법인 사업보고서에는 고객사 명단이 없다. 상장사 쪽 사업보고서의
 * '회계감사인의 감사의견 등' 절을 모아 뒤집은 값이다.
 *
 * 스팩(기업인수목적회사)은 사업이 없는 껍데기라 감사 업무량이 사업회사와
 * 비교가 안 된다. 전체로는 2.6% 뿐이지만 스팩만 맡는 법인이 있어서
 * (네트워크회계법인은 11곳 중 10곳), 눈에 띌 만큼 많을 때만 따로 적는다.
 * 미리보기 세 곳에는 사업회사를 먼저 올린다.
 */
/**
 * JSON-LD 를 <script> 안에 안전하게 넣는다.
 *
 * esc() 를 쓰면 안 된다. 따옴표를 &quot; 로 바꿔 버려 JSON 이 깨진다.
 * 여기서 막아야 하는 건 하나뿐이다 — 값 안의 '</script>' 가 태그를 닫는 것.
 */
function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

const PREVIEW = 3;

function clientSection(clients) {
  if (!clients || !clients.length) return "";

  const real = clients.filter((c) => !c.spac).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const spac = clients.filter((c) => c.spac).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const ordered = [...real, ...spac];
  // 비중으로만 판단한다. 개수로 걸면 199 곳 중 3 곳인 대주에도 붙어
  // 오히려 잡음이 된다. 다섯에 하나 이상일 때만 적는다.
  const noteworthy = spac.length >= 2 && spac.length * 5 >= clients.length;

  const chip = (c) => `<li${c.spac ? ' class="spac"' : ""}>${esc(c.name)}` +
    `<span class="mkt">${esc(c.market === "유가" ? "코스피" : "코스닥")}</span></li>`;

  const head = ordered.slice(0, PREVIEW).map(chip).join("");
  const rest = ordered.slice(PREVIEW);

  return `
  <section>
    <div class="sec-head"><h2>상장사 감사 고객</h2><span class="unit">최근 사업보고서 기준</span></div>
    <div class="client-count">${clients.length}곳${
      noteworthy ? ` <span class="spac-note">스팩 ${spac.length}곳 포함</span>` : ""}</div>
    <ul class="clients">${head}</ul>
    ${rest.length ? `<details class="more-clients">
      <summary>나머지 ${rest.length}곳 보기</summary>
      <ul class="clients">${rest.map(chip).join("")}</ul>
    </details>` : ""}
    <p class="caption">각 회사가 사업보고서에 적은 회계감사인을 모아 정리했습니다.
      감사인은 해마다 바뀔 수 있습니다.</p>
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
    ? `최근 ${data.length}개 사업연도를 모두 더하면 ${total}명입니다.`
    : `최근 ${data.length}개 사업연도에 수습회계사가 없었습니다.`;

  return `
  <section class="trainee-sec">
    <div class="sec-head"><h2>수습회계사</h2><span class="unit">사업보고서 인력현황 기준</span></div>
    ${traineeHistory(data)}
    <p class="caption strong">${esc(caption)}</p>
    <p class="caption">각 사업연도 결산일에 소속된 수습회계사 수입니다.
      공인회계사 등록을 마치면 이 수에서 빠지므로 그해 채용 인원과는 다릅니다.</p>
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

export function renderFirmPage({ firm, financials, postings, ranks, clients }) {
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

  // 제목에 실제로 검색되는 말을 넣는다. '규모·채용 정보' 로는 아무도 찾지
  // 않는다. 사람들이 치는 건 'OO회계법인 매출', 'OO회계법인 채용' 이다.
  const title = latest?.revenue != null
    ? `${firm.name} 매출·회계사 수·채용 정보 | CPAPING`
    : `${firm.name} 채용 정보 | CPAPING`;
  const trainee = latest?.trainee_count;
  const description = latest?.revenue != null
    ? `${firm.name}의 매출 ${fmt(latest.revenue, 0)}억원, 회계사 ${latest.cpa_count ?? "-"}명` +
      (trainee ? `, 수습회계사 ${trainee}명` : "") +
      `. 5개년 재무와 부문별 매출, 로컬 회계법인 중 순위, 상장사 감사 고객을 정리했습니다.`
    : `${firm.name}의 채용 공고와 기본 정보를 정리했습니다.`;

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
<script type="application/ld+json">
${jsonLd({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "회계법인", item: `${SITE}/firms` },
        { "@type": "ListItem", position: 2, name: firm.name },
      ],
    },
    {
      "@type": "Organization",
      name: firm.name,
      url: `${SITE}/firm/${encodeURIComponent(firm.slug)}`,
      ...(firm.address ? { address: { "@type": "PostalAddress",
                                      streetAddress: firm.address,
                                      addressCountry: "KR" } } : {}),
      ...(firm.homepage ? { sameAs: [firm.homepage] } : {}),
      ...(latest?.cpa_count ? { numberOfEmployees: {
            "@type": "QuantitativeValue", value: latest.cpa_count } } : {}),
      knowsAbout: ["회계감사", "세무자문"],
    },
  ],
})}
</script>
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

/* 칸 사이 선을 nth-child 로 그리면 개수가 바뀔 때마다 규칙을 고쳐야 한다.
   실제로 타일이 넷에서 다섯이 되자 2행과 3행 사이 선이 사라졌다.
   배경색 위에 1px 를 비우는 방식은 개수와 무관하게 맞는다. */
.tiles{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;
  background:var(--line-2);border-bottom:1px solid var(--line)}
.tile{padding:14px var(--pad-x);background:var(--bg-subtle)}
@media(max-width:860px){.tiles{grid-template-columns:repeat(4,1fr)}}
@media(max-width:560px){
  .tiles{grid-template-columns:repeat(2,1fr)}
  /* 폰에서는 넷만 남겨 2×2 로 맞춘다. 1인당 매출은 아래 기본 정보에 있다. */
  .tile.opt{display:none}
  .tile{padding-left:14px;padding-right:14px}
  .t-value{font-size:18px}
}
.t-label{font-size:11px;color:var(--ink-3)}
.t-value{font-size:20px;font-weight:600;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;margin-top:2px}
.t-value.up{color:var(--up)}
.t-value small{font-size:13px;font-weight:500;margin-left:1px}
.t-value .narrow{display:none}
@media(max-width:560px){
  .t-value .wide{display:none}
  .t-value .narrow{display:inline}
}
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
.client-count{font-size:19px;font-weight:600;letter-spacing:-.02em;margin-bottom:10px;font-variant-numeric:tabular-nums}
.spac-note{font-size:11.5px;font-weight:400;color:var(--ink-3);margin-left:6px}
ul.clients{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
ul.clients li{display:flex;align-items:baseline;gap:5px;font-size:12.5px;
  background:var(--bg-subtle);border:1px solid var(--line-2);border-radius:3px;padding:4px 8px}
ul.clients li.spac{color:var(--ink-2)}
ul.clients .mkt{font-size:10px;color:var(--ink-3)}
details.more-clients{margin-top:8px}
details.more-clients summary{font-size:12px;color:var(--accent);cursor:pointer;padding:4px 0}
details.more-clients summary:hover{text-decoration:underline}
details.more-clients ul.clients{margin-top:8px}
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
    ${clientSection(clients)}
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
