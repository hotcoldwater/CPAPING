/**
 * web/index.html 의 플레이스홀더에 Supabase 공개 키를 채워 dist/ 로 낸다.
 *
 * publishable key 는 프론트엔드에 노출되도록 설계된 값이라 브라우저에 담아도
 * 안전하다. 다만 소스에 하드코딩해 두면 프로젝트를 바꿀 때 놓치기 쉬워
 * 빌드 시점에 주입한다.
 *
 * 의존성이 없다. Cloudflare Pages 빌드 이미지에서 그대로 돈다.
 *
 *   node web/build.mjs
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { renderFirmPage } from "./firm-page.mjs";
import { renderFirmsPage } from "./firms-page.mjs";
import { renderPostingPage } from "./posting-page.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 로컬 회계법인 안에서의 순위. 빅4 는 자릿수가 달라 같이 세면 로컬끼리의
 * 차이가 뭉개지므로 뺀다.
 */
function localRanks(firms, financials) {
  const BIG4 = /^(삼일|삼정|안진|한영)회계법인$/;
  const latest = new Map();
  for (const f of financials) {
    const cur = latest.get(f.firm_id);
    if (!cur || f.fiscal_year > cur.fiscal_year) latest.set(f.firm_id, f);
  }

  const pool = firms
    .filter((f) => !BIG4.test(f.name))
    .map((f) => ({ id: f.id, row: latest.get(f.id) }))
    .filter((x) => x.row && Number(x.row.revenue) > 0);

  const out = new Map();
  const rankBy = (key, label) => {
    const list = pool
      .map((x) => ({ id: x.id, v: Number(x.row[key] ?? 0) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    list.forEach((x, i) => {
      if (!out.has(x.id)) out.set(x.id, {});
      out.get(x.id)[label] = {
        rank: i + 1, total: list.length, value: Math.round(x.v),
      };
    });
  };
  rankBy("revenue", "revenue");
  rankBy("revenue_audit", "audit");
  return out;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const REPLACEMENTS = {
  __SUPABASE_URL__: "NEXT_PUBLIC_SUPABASE_URL",
  __SUPABASE_PUBLISHABLE_KEY__: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
};

/** 로컬 개발 편의를 위해 .env 를 읽는다. CI 에서는 실제 환경변수가 이긴다. */
function loadDotEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const fromFile = loadDotEnv();
const read = (name) => process.env[name] || fromFile[name] || "";

// 방문자 분석 스크립트는 여기서 넣지 않는다. Cloudflare Web Analytics 를
// 자동 주입(RUM: Enable)으로 켜 두었고, 엣지가 HTML 을 내보낼 때 beacon 을
// 붙인다. 여기서 또 넣으면 방문자가 두 번 집계된다.
//
// 확인할 때 주의: Cloudflare 는 브라우저 UA 에만 주입한다. 그냥 curl 로
// 받으면 beacon 이 안 보여서 꺼진 것처럼 읽힌다. UA 를 줘야 한다.
//   curl -sL -A "Mozilla/5.0 ... Chrome/128.0.0.0 ..." https://cpaping.com \
//     | grep beacon.min.js

let html = readFileSync(join(HERE, "index.html"), "utf8");

/**
 * 빌드 시점의 실제 공고를 index.html 에 심는다.
 *
 * 공고 목록은 브라우저가 JS 로 불러오는데, 검색엔진과 카카오 미리보기는
 * 그걸 기다려 주지 않는다. 그래서 HTML 안에 목록을 함께 넣어 둔다.
 * 네트워크를 못 쓰는 환경에서도 이 값이 화면에 나온다.
 *
 * 손으로 적어 두면 시간이 지나 마감된 공고가 검색결과에 남는다.
 * 빌드할 때마다 실제 값으로 갈아 끼운다.
 */
async function fetchPostings(url, key) {
  const query =
    "/rest/v1/job_postings?select=company_name,title,region,region_group,deadline,posted_at," +
    "employment_type,detail_url,removed_at,original_posted_at,repost_count,ij_id,view_count," +
    "source,is_big4,career_min_years,career_max_years" +
    "&is_target=is.true&order=posted_at.desc";
  const res = await fetch(url.replace(/\/$/, "") + query, { headers: { apikey: key } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const missing = [];

for (const [placeholder, envName] of Object.entries(REPLACEMENTS)) {
  const value = read(envName);
  if (!value || value.includes("xxxx")) {
    missing.push(envName);
    continue;
  }
  html = html.replaceAll(placeholder, value);
}

// 실제 공고로 갈아 끼운다. 실패하면 기존 값을 그대로 둔다 —
// 빌드가 멈추는 것보다 조금 오래된 목록이 낫다.
if (!missing.length) {
  try {
    const rows = await fetchPostings(read("NEXT_PUBLIC_SUPABASE_URL"),
                                     read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"));
    const json = JSON.stringify(rows, null, 1).replace(/<\/script/gi, "<\\/script");
    html = html.replace(/const FALLBACK = \[[\s\S]*?\n\];/,
                        `const FALLBACK = ${json};`);
    console.log(`  공고 ${rows.length}건을 HTML 에 심었습니다`);
  } catch (err) {
    console.warn(`  공고를 가져오지 못했습니다 (${err.message}). 기존 값을 유지합니다.`);
  }
}

if (missing.length) {
  console.error(`환경변수가 없습니다: ${missing.join(", ")}`);
  console.error("Cloudflare Pages 라면 Settings > Environment variables 에 추가하세요.");
  process.exit(1);
}

// ── 방문 분석 ─────────────────────────────────────────────
// Google Analytics 4 와 Microsoft Clarity. 2026-09-09 운영자 결정. Cloudflare
// Web Analytics 는 엣지에서 자동 주입되므로 여기 없다. 세 도구가 함께 돈다.
//
// 빌드가 만드는 모든 HTML 에 넣는다. Pages Functions 가 그리는 페이지
// (확인·해지·구독 설정)에는 넣지 않는다 — 주소에 토큰이 실려 있어 분석
// 도구로 새 나가면 안 된다.
//
// Clarity 는 세션 녹화 도구다. 이메일 입력칸에 data-clarity-mask 를 달아 두고,
// 대시보드 Masking 도 Strict 로 둔다. 방침 제8조가 이 두 도구를 설명한다 —
// 도구를 바꾸면 방침도 같이 고친다.
const ANALYTICS = `
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ML4R2L4YJS"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-ML4R2L4YJS');
</script>
<script type="text/javascript">
  (function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window, document, "clarity", "script", "yf5i7m260v");
</script>
`;
const withAnalytics = (page) =>
  page.includes("</head>") ? page.replace("</head>", `${ANALYTICS}</head>`) : page;

const out = join(HERE, "dist");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), withAnalytics(html), "utf8");

// ── 회원 화면 (Phase 3) ────────────────────────────────────
// 공개 키를 auth.js 에 심고, 네 화면을 디렉터리 형태로 낸다. 분석 스니펫은
// 넣지 않는다 — /auth/callback/ 주소에 일회용 코드가 실리고, 이 화면들은
// 검색에 걸릴 이유도 없다(noindex).
const inject = (text) => {
  for (const [placeholder, envName] of Object.entries(REPLACEMENTS)) text = text.replaceAll(placeholder, read(envName));
  return text;
};
writeFileSync(join(out, "auth.js"), inject(readFileSync(join(HERE, "auth.js"), "utf8")), "utf8");
writeFileSync(join(out, "comments.js"), inject(readFileSync(join(HERE, "comments.js"), "utf8")), "utf8");
copyFileSync(join(HERE, "auth.css"), join(out, "auth.css"));
for (const file of ["mail-connect.js", "career.css"]) copyFileSync(join(HERE, file), join(out, file));
copyFileSync(join(HERE, "comments.css"), join(out, "comments.css"));
const AUTH_PAGES = { "login.html": "login", "auth-callback.html": "auth/callback",
                     "onboarding.html": "onboarding", "account.html": "account", "mail-connect.html": "mail-connect" };
for (const [file, dir] of Object.entries(AUTH_PAGES)) {
  const target = join(out, dir); mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "index.html"), inject(readFileSync(join(HERE, file), "utf8")), "utf8");
}
console.log(`  회원 화면 ${Object.keys(AUTH_PAGES).length}개 생성 (/login/ /auth/callback/ /onboarding/ /account/)`);

// 방침 페이지, 파비콘, OG 이미지 등 그대로 나가는 파일들
const ASSETS = [
  "privacy.html",
  "terms.html",
  // 없는 경로에 진짜 404 를 돌려주기 위한 것. 이 파일이 없으면 Cloudflare
  // Pages 가 index.html 을 200 으로 내주고, 유령 URL 수백 개가 홈페이지와
  // 같은 내용·같은 canonical 로 잡혀 사이트 전체가 중복 덩어리로 보인다.
  "404.html",
  "robots.txt",
  "favicon.ico",
  "favicon.svg",
  "apple-touch-icon.png",
  "icon-512.png",
  "og.png",
];
for (const name of ASSETS) {
  const from = join(HERE, name);
  if (!existsSync(from)) { console.warn(`  (없음) ${name}`); continue; }
  // HTML 은 분석 스니펫을 넣어서, 나머지는 그대로
  if (name.endsWith(".html")) writeFileSync(join(out, name), withAnalytics(readFileSync(from, "utf8")), "utf8");
  else copyFileSync(from, join(out, name));
}

// ── sitemap ──────────────────────────────────────────────
// 검색엔진에 어떤 페이지가 있는지 알린다. 법인 페이지가 늘어나면
// 여기에 함께 실린다.
const SITE = "https://cpaping.com";

function sitemap(paths) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = paths
    .map((p) => `  <url>\n    <loc>${SITE}${p.loc}</loc>\n` +
                `    <lastmod>${today}</lastmod>\n` +
                `    <changefreq>${p.freq}</changefreq>\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
         `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

const pages = [
  { loc: "/", freq: "hourly" },
  { loc: "/privacy", freq: "yearly" },
  { loc: "/terms", freq: "yearly" },
];

// ── 법인 페이지 ───────────────────────────────────────────
// 클라이언트에서 그리면 검색엔진이 못 읽는다. "OO회계법인 규모" 같은
// 검색으로 들어오게 하는 것이 목적이라 정적으로 찍어낸다.
/**
 * 이름값을 하도록 끝까지 받아온다.
 *
 * PostgREST 는 한 번에 1,000 행까지만 준다. 더 있어도 오류를 내지 않고
 * 조용히 잘라서 준다. 그래서 재무가 1,000 행을 넘긴 순간부터 뒤쪽 법인의
 * 자료가 빌드에서 통째로 빠졌는데, 페이지가 "재무 준비 중" 으로 멀쩡히
 * 그려져서 티가 나지 않았다.
 */
const PAGE = 1000;

async function fetchAll(url, key, path) {
  const base = url.replace(/\/$/, "") + "/rest/v1/" + path;
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${base}${sep}limit=${PAGE}&offset=${offset}`,
                            { headers: { apikey: key } });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${path}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

if (!missing.length) {
  try {
    const url = read("NEXT_PUBLIC_SUPABASE_URL");
    const key = read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

    const [firms, financials, postings] = await Promise.all([
      fetchAll(url, key, "firms?select=*&order=name.asc"),
      fetchAll(url, key, "firm_financials?select=*"),
      fetchAll(url, key,
        "job_postings?select=company_name,title,region,region_group,deadline,posted_at," +
        "employment_type,detail_url,removed_at,is_big4,ij_id,source,career_min_years,career_max_years&order=posted_at.desc"),
    ]);

    // 법인별 댓글 수 — 뷰가 아직 없으면(012 전) 0 으로 간다
    let firmComments = {};
    try {
      const cc = await fetchAll(url, key, "comment_counts?select=target_id,comments&target_type=eq.firm");
      firmComments = Object.fromEntries(cc.map((r) => [r.target_id, r.comments]));
    } catch { /* 댓글 수 없이 */ }

    const ranks = localRanks(firms, financials);
    // 상장사 감사 고객을 회계법인별로 묶는다.
    const clientRows = await fetchAll(url, key,
      "audit_clients?select=firm_name,company,market,is_spac&order=company.asc");
    const clients = new Map();
    for (const r of clientRows) {
      if (!clients.has(r.firm_name)) clients.set(r.firm_name, []);
      clients.get(r.firm_name).push(
        { name: r.company, market: r.market || "", spac: !!r.is_spac });
    }

    let built = 0;
    for (const firm of firms) {
      // 별칭까지 훑어야 지점 표기('삼원회계법인(성서지점)')가 붙는다
      const names = new Set([firm.name, ...(firm.aliases || [])]);
      const mine = postings.filter((p) => names.has(p.company_name));
      const fin = financials.filter((f) => f.firm_id === firm.id);

      const dir = join(out, "firm", firm.slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"),
                    withAnalytics(renderFirmPage({ firm, financials: fin, postings: mine,
                                     ranks: ranks.get(firm.id),
                                     clients: clients.get(firm.name) })), "utf8");
            // 슬래시를 붙인 형태가 서버가 실제로 200 을 주는 주소다. 안 붙이면
      // Cloudflare Pages 가 308 로 붙여서 보내는데, sitemap 과 canonical 이
      // 리다이렉트되는 쪽을 가리키면 검색엔진이 대표 URL 을 스스로 고른다.
      pages.push({ loc: `/firm/${encodeURIComponent(firm.slug)}/`, freq: "weekly" });
      built++;
    }
    console.log(`  법인 페이지 ${built}개 생성`);

    // /firms — 법인 비교표. 색과 상단바를 index.html 과 나눠 쓰려고 그쪽
    // <style> 을 통째로 넣는다. 토큰을 두 군데서 관리하지 않기 위해서다.
    const baseCss = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];
    const firmsDir = join(out, "firms");
    mkdirSync(firmsDir, { recursive: true });
    writeFileSync(join(firmsDir, "index.html"),
      withAnalytics(renderFirmsPage({ firms, financials, comments: firmComments }).replace("__BASE__", baseCss)), "utf8");
    pages.push({ loc: "/firms/", freq: "weekly" });
    console.log(`  법인 비교표 생성 (/firms)`);
  } catch (err) {
    console.warn(`  법인 페이지를 만들지 못했습니다 (${err.message})`);
  }
}

// ── 공고 상세 페이지 ─────────────────────────────────────
// 목록에서 공고를 누르면 한공회로 바로 나가지 않고 여기로 온다. 원문은
// 전재하지 않고 게시판의 항목만 정리한다 — 본문·담당자 연락처는 원문 버튼
// 너머에 둔다. 내려간 공고도 페이지를 남긴다(주소가 죽으면 검색·링크가 깨진다).
if (!missing.length) try {
  const url = read("NEXT_PUBLIC_SUPABASE_URL");
  const key = read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const full = await fetchAll(url, key,
    "job_postings?select=ij_id,title,company_name,region,work_region,employment_type," +
    "hiring_status,headcount,career,salary,education,posted_at,deadline,detail_url," +
    "job_category,original_posted_at,repost_count,removed_at,is_expired,view_count,source,audience,is_big4,career_min_years,career_max_years" +
    // 수습·경력 모두 빅4 포함. 마감된 공고도 남긴다.
    // 마감됐다고 페이지를 지우면 목록·메일에서 이어진 링크가 죽는다.
    "&or=(and(source.eq.kicpa:trainee,or(is_target.is.true,is_expired.is.true))," +
    "and(source.eq.kicpa:cpa,audience.eq.cpa,or(is_target.is.true,is_expired.is.true)))&order=posted_at.desc");
  const firmsAll = await fetchAll(url, key, "firms?select=id,name,aliases,slug,region");
  const finAll = await fetchAll(url, key, "firm_financials?select=firm_id,fiscal_year,revenue,cpa_count,trainee_count");
  const byName = new Map();
  for (const f of firmsAll) for (const n of [f.name, ...(f.aliases || [])]) byName.set(n, f);
  const latestFin = new Map();
  for (const r of finAll) {
    const cur = latestFin.get(r.firm_id);
    if (!cur || String(r.fiscal_year) > String(cur.fiscal_year)) latestFin.set(r.firm_id, r);
  }
  rmSync(join(out, "posting"), { recursive: true, force: true });
  let made = 0;
  for (const posting of full) {
    if (!posting.ij_id) continue;
    const firm = byName.get(posting.company_name) || null;
    const others = full.filter((o) => o.company_name === posting.company_name && o.ij_id !== posting.ij_id);
    const dir = join(out, "posting", String(posting.ij_id));
    mkdirSync(dir, { recursive: true });
    // inject: 조회수 갱신 스크립트가 쓰는 공개 키를 채운다
    writeFileSync(join(dir, "index.html"), inject(withAnalytics(renderPostingPage({
      posting, firm, latestFin: firm ? latestFin.get(firm.id) || null : null, others }))), "utf8");
    pages.push({ loc: `/posting/${encodeURIComponent(posting.ij_id)}/`,
                 freq: posting.removed_at ? "monthly" : "daily" });
    made++;
  }
  console.log(`  공고 페이지 ${made}개 생성`);
} catch (err) {
  console.warn(`  공고 페이지를 만들지 못했습니다 (${err.message})`);
}

// 게시판 — 공개 화면이라 분석 스니펫을 넣고, 글은 화면이 Supabase 에서 읽으므로 공개 키를 채운다.
// /board/<번호>/ 는 functions/board/[[path]].js 가 /board/post/ 셸로 잇는다.
const BOARD_PAGES = { "board.html": "board", "board-write.html": "board/write", "board-post.html": "board/post" };
for (const [file, dir] of Object.entries(BOARD_PAGES)) {
  const target = join(out, dir); mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "index.html"), inject(withAnalytics(readFileSync(join(HERE, file), "utf8"))), "utf8");
}
copyFileSync(join(HERE, "board.css"), join(out, "board.css"));
pages.push({ loc: "/board/", freq: "hourly" });
console.log(`  게시판 화면 ${Object.keys(BOARD_PAGES).length}개 생성 (/board/ /board/write/ /board/post/)`);

writeFileSync(join(out, "sitemap.xml"), sitemap(pages), "utf8");

console.log(`빌드 완료 → ${out} (index.html + 자산 ${ASSETS.length}개 + sitemap ${pages.length}건)`);
