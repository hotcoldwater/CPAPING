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

import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { renderFirmPage } from "./firm-page.mjs";
import { renderFirmsPage } from "./firms-page.mjs";
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
    "/rest/v1/job_postings?select=company_name,title,region,deadline,posted_at," +
    "employment_type,detail_url,removed_at,original_posted_at,repost_count" +
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

const out = join(HERE, "dist");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), html, "utf8");

// 방침 페이지, 파비콘, OG 이미지 등 그대로 나가는 파일들
const ASSETS = [
  "privacy.html",
  "robots.txt",
  "favicon.ico",
  "favicon.svg",
  "apple-touch-icon.png",
  "icon-512.png",
  "og.png",
];
for (const name of ASSETS) {
  const from = join(HERE, name);
  if (existsSync(from)) copyFileSync(from, join(out, name));
  else console.warn(`  (없음) ${name}`);
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
        "job_postings?select=company_name,title,region,deadline,posted_at," +
        "employment_type,detail_url,removed_at,is_big4&order=posted_at.desc"),
    ]);

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
                    renderFirmPage({ firm, financials: fin, postings: mine,
                                     ranks: ranks.get(firm.id),
                                     clients: clients.get(firm.name) }), "utf8");
      pages.push({ loc: `/firm/${encodeURIComponent(firm.slug)}`, freq: "weekly" });
      built++;
    }
    console.log(`  법인 페이지 ${built}개 생성`);

    // /firms — 법인 비교표. 색과 상단바를 index.html 과 나눠 쓰려고 그쪽
    // <style> 을 통째로 넣는다. 토큰을 두 군데서 관리하지 않기 위해서다.
    const baseCss = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];
    const firmsDir = join(out, "firms");
    mkdirSync(firmsDir, { recursive: true });
    writeFileSync(join(firmsDir, "index.html"),
      renderFirmsPage({ firms, financials }).replace("__BASE__", baseCss), "utf8");
    pages.push({ loc: "/firms", freq: "weekly" });
    console.log(`  법인 비교표 생성 (/firms)`);
  } catch (err) {
    console.warn(`  법인 페이지를 만들지 못했습니다 (${err.message})`);
  }
}

writeFileSync(join(out, "sitemap.xml"), sitemap(pages), "utf8");

console.log(`빌드 완료 → ${out} (index.html + 자산 ${ASSETS.length}개 + sitemap ${pages.length}건)`);
