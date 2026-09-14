import { renderPostingPage } from '../../web/posting-page.mjs';
import { navigation } from '../../web/navigation.mjs';
import { POSTING_FIELDS, POSTING_SCOPE } from '../../web/posting-data.mjs';
import { page } from '../_shared.js';

function message(status, title, lead) {
  const response = page({ title, lead });
  return new Response(response.body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      ...(status === 503 ? { 'retry-after': '30' } : {}) },
  });
}

async function readRows(config, table, params) {
  const url = new URL(`${config.url}/rest/v1/${table}`);
  url.search = new URLSearchParams(params).toString();
  // Use only the public key and public columns; no service-role credentials reach the page.
  const response = await fetch(url, {
    headers: { apikey: config.key }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Posting read failed (${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Invalid posting response');
  return rows;
}

async function serve({ request, env, params }) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
  }
  const parts = (params.path || []).filter(Boolean);
  if (parts.length !== 1 || !/^\d{1,20}$/.test(parts[0])) {
    return message(404, '공고를 찾을 수 없습니다', '공고 목록에서 다시 확인해 주세요.');
  }
  const id = parts[0];
  const config = {
    url: (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, ''),
    key: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  let posting;
  try {
    if (!config.url || !config.key) throw new Error('Public posting configuration missing');
    [posting] = await readRows(config, 'job_postings', {
      select: POSTING_FIELDS, ij_id: `eq.${id}`, or: POSTING_SCOPE, limit: '1',
    });
  } catch {
    // A database outage is not a missing job. Older build snapshots remain useful.
    console.warn('Live posting lookup unavailable; checking static snapshot');
    try {
      const snapshot = await env.ASSETS.fetch(new Request(request.url, { method: 'GET' }));
      if (snapshot.status === 200) {
        const headers = new Headers(snapshot.headers);
        headers.set('cache-control', 'no-store');
        headers.set('x-cpaping-posting-source', 'static-fallback');
        return new Response(snapshot.body, { status: 200, headers });
      }
    } catch { /* No snapshot; let the visitor retry instead of returning a false 404. */ }
    return message(503, '공고를 잠시 불러올 수 없습니다', '잠시 후 새로고침해 주세요.');
  }
  if (!posting) return message(404, '공고를 찾을 수 없습니다', '공고 목록에서 다시 확인해 주세요.');

  // Supplementary firm data must never prevent the posting itself from opening.
  const quotedName = JSON.stringify(posting.company_name || '');
  const [firmResult, othersResult] = await Promise.allSettled([
    readRows(config, 'firms', { select: 'id,name,aliases,slug,region',
      or: `(name.eq.${quotedName},aliases.cs.{${quotedName}})`, limit: '1' }),
    readRows(config, 'job_postings', { select: POSTING_FIELDS, or: POSTING_SCOPE,
      company_name: `eq.${quotedName}`, ij_id: `neq.${id}`, order: 'posted_at.desc', limit: '6' }),
  ]);
  const firm = firmResult.status === 'fulfilled' ? firmResult.value[0] || null : null;
  const others = othersResult.status === 'fulfilled' ? othersResult.value : [];
  let latestFin = null;
  if (firm) {
    try {
      [latestFin] = await readRows(config, 'firm_financials', {
        select: 'firm_id,fiscal_year,revenue,cpa_count,trainee_count', firm_id: `eq.${firm.id}`,
        order: 'fiscal_year.desc', limit: '1',
      });
    } catch { /* Keep the posting and firm link even when financial data is unavailable. */ }
  }
  let html = navigation(renderPostingPage({ posting, firm, latestFin, others }), `/posting/${id}/`);
  // These are the same public values used by the static build's view-count script.
  const scriptValue = value => JSON.stringify(value).slice(1, -1).replace(/</g, '\\u003c');
  html = html.replaceAll('__SUPABASE_URL__', () => scriptValue(config.url))
    .replaceAll('__SUPABASE_PUBLISHABLE_KEY__', () => scriptValue(config.key));
  return new Response(html, { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'x-cpaping-posting-source': 'live',
  } });
}

export async function onRequest(context) {
  const response = await serve(context);
  return context.request.method === 'HEAD'
    ? new Response(null, { status: response.status, headers: response.headers }) : response;
}
