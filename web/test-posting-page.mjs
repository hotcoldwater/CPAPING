import assert from "node:assert/strict";
import test from "node:test";
import { renderPostingPage } from "./posting-page.mjs";

const render = (overrides = {}) => renderPostingPage({
  posting: {
    ij_id: "sample", company_name: "삼일회계법인", title: "수습 회계사 모집",
    source: "kicpa:trainee", is_big4: true, employment_type: "Full Time",
    posted_at: "2026-09-11", deadline: "2099-01-01",
    detail_url: "https://example.com/posting", ...overrides,
  },
  firm: null, latestFin: null, others: [],
});

test("빅4 수습 공고는 신입과 빅4를 함께 표시하고 원문으로 연결한다", () => {
  const html = render();
  assert.ok(html.includes("신입 · 빅4"));
  assert.ok(html.includes('<span class="chip">빅4</span>'));
  assert.ok(html.includes('href="https://example.com/posting"'));
  assert.ok(html.includes("구인(수습CPA)"));
});

test("빅4 경력 공고의 기존 표기를 유지한다", () => {
  const html = render({ source: "kicpa:cpa", career_min_years: 3, career_max_years: 5 });
  assert.ok(html.includes("경력 · 빅4"));
  assert.ok(html.includes("3~5년"));
});

test("로컬 공고에는 빅4 배지를 붙이지 않는다", () => {
  const html = render({ company_name: "동성회계법인", is_big4: false });
  assert.ok(!html.includes('<span class="chip">빅4</span>'));
});
