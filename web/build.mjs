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

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
const missing = [];

for (const [placeholder, envName] of Object.entries(REPLACEMENTS)) {
  const value = read(envName);
  if (!value || value.includes("xxxx")) {
    missing.push(envName);
    continue;
  }
  html = html.replaceAll(placeholder, value);
}

if (missing.length) {
  console.error(`환경변수가 없습니다: ${missing.join(", ")}`);
  console.error("Cloudflare Pages 라면 Settings > Environment variables 에 추가하세요.");
  process.exit(1);
}

const out = join(HERE, "dist");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), html, "utf8");
console.log(`빌드 완료 → ${join(out, "index.html")}`);
