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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
writeFileSync(join(out, "sitemap.xml"), sitemap(pages), "utf8");

console.log(`빌드 완료 → ${out} (index.html + 자산 ${ASSETS.length}개 + sitemap ${pages.length}건)`);
