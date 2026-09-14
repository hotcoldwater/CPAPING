import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/posting/[[path]].js';
import { renderPostingPage } from '../web/posting-page.mjs';
import { navigation } from '../web/navigation.mjs';

const id = '1789360325910';
const job = { id: 'job-uuid', ij_id: id, company_name: '예지회계법인', title: '새 수습회계사 모집',
  posted_at: '2026-09-14', deadline: '2099-01-01', source: 'kicpa:trainee', is_target: true,
  detail_url: `https://www.kicpa.or.kr/home/jobOffrSrchNewGnrl/detail.face?ijIdNum=${id}` };
function context(path = [id], method = 'GET', snapshot = 404) {
  return { request: new Request(`https://cpaping.com/posting/${path.join('/')}/`, { method }),
    params: { path }, env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://public.example', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
      SUPABASE_SECRET_KEY: 'must-not-leak',
      ASSETS: { fetch: async () => new Response('static snapshot', { status: snapshot }) },
    } };
}
function mockDatabase(t, options = {}) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const u = new URL(url); calls.push({ url: u, init });
    assert.equal(init.headers.apikey, 'public-key');
    if (u.searchParams.get('ij_id')?.startsWith('neq.')) assert.ok(!u.searchParams.get('select').includes('body'));
    if (options.outage) return new Response('upstream failed', { status: 504 });
    if (u.pathname.endsWith('/job_postings')) {
      if (u.searchParams.get('ij_id').startsWith('eq.')) return Response.json(options.absent ? [] : [{ ...job, ...options.job }]);
      return Response.json([]);
    }
    if (options.supplementFailure) return new Response('unavailable', { status: 503 });
    if (u.pathname.endsWith('/firms')) return Response.json([{ id: 'firm-id', name: '예지회계법인', slug: '예지', region: '서울' }]);
    return Response.json([{ fiscal_year: 2025, revenue: 100, cpa_count: 20, trainee_count: 2 }]);
  });
  return calls;
}

test('new posting renders without any prebuilt asset and preserves metadata, links and comments', async t => {
  const calls = mockDatabase(t);
  const ctx = context();ctx.env.ASSETS.fetch = () => { throw new Error('Live route must not require a static page'); };
  const response = await onRequest(ctx);const html = await response.text();
  assert.equal(response.status, 200);assert.equal(response.headers.get('x-cpaping-posting-source'), 'live');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(html.includes(job.title));assert.ok(html.includes(job.detail_url));assert.ok(html.includes(`data-target-id="${id}"`));
  assert.ok(html.includes(`rel="canonical" href="https://cpaping.com/posting/${id}/"`));
  assert.ok(html.includes('/applications/?posting=job-uuid'));
  assert.ok(html.includes('/firm/'));assert.ok(html.includes('100억'));
  assert.ok(!html.includes('must-not-leak'));assert.ok(!html.includes('__SUPABASE_'));
  assert.ok(calls.every(c => c.init.signal instanceof AbortSignal));
  assert.equal(calls[0].url.searchParams.get('ij_id'), `eq.${id}`);
});
test('missing IDs return an uncached real 404', async t => {
  mockDatabase(t, { absent: true });
  const response = await onRequest(context());assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('invalid and nested IDs are rejected without querying DB', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not fetch'); });
  for (const parts of [[], ['foo'], [id,'extra'], ['1&select=body'], ['9'.repeat(21)]]) {
    assert.equal((await onRequest(context(parts))).status, 404);
  }
});
test('POST is rejected and HEAD returns only headers', async t => {
  mockDatabase(t);
  const denied = await onRequest(context([id], 'POST'));assert.equal(denied.status,405);
  assert.equal(denied.headers.get('allow'), 'GET, HEAD');
  const head = await onRequest(context([id], 'HEAD'));assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('DB outage uses existing static snapshot without caching it', async t => {
  mockDatabase(t, { outage: true });
  const response=await onRequest(context([id],'GET',200));
  assert.equal(response.status,200);assert.equal(await response.text(),'static snapshot');
  assert.equal(response.headers.get('x-cpaping-posting-source'),'static-fallback');
  assert.equal(response.headers.get('cache-control'),'no-store');
});
test('DB outage with no snapshot is retryable 503, never a false 404', async t => {
  mockDatabase(t, { outage: true });const response=await onRequest(context());
  assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'30');
  assert.ok((await response.text()).includes('잠시 후 새로고침'));
});
test('missing public config never falls back to a service-role key', async t => {
  t.mock.method(globalThis,'fetch',()=>{throw new Error('Must not use service role');});
  const ctx=context();delete ctx.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.equal((await onRequest(ctx)).status,503);
});
test('supplementary data failure does not hide the job', async t => {
  mockDatabase(t,{ supplementFailure:true });const response=await onRequest(context());
  assert.equal(response.status,200);assert.ok((await response.text()).includes(job.title));
});
test('removed and expired listings retain their URL but omit active JobPosting schema', async t => {
  mockDatabase(t,{ job:{removed_at:'2026-09-15T00:00:00Z',is_expired:true} });
  const response=await onRequest(context());const html=await response.text();
  assert.equal(response.status,200);assert.ok(html.includes('공고 내림'));assert.ok(!html.includes('"@type":"JobPosting"'));
  assert.ok(!html.includes('/applications/?posting='));
});
test('title escaping prevents markup injection from crawled data', async t => {
  mockDatabase(t,{job:{title:'<img src=x onerror=alert(1)>'}});
  const html=await (await onRequest(context())).text();
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));
});
test('navigation retains only header status; posting actions occur once', () => {
  const html=navigation(renderPostingPage({posting:job,others:[]}),`/posting/${id}/`);
  const header=html.match(/<header[\s\S]*?<\/header>/)[0];
  assert.ok(!header.includes('한공회 원문 보기'));
  assert.equal((html.match(/한공회 원문 보기 ↗/g)||[]).length,1);
  assert.ok(header.includes('지원현황'));assert.ok(!header.includes('/essay/'));
  const home=navigation('<head></head><header class="topbar"><div class="status">1분마다 확인 중</div></header>');
  assert.ok(home.includes('1분마다 확인 중'));
});
test('deadline follows Korean midnight on a UTC edge server', t => {
  t.mock.method(Date,'now',()=>Date.parse('2026-09-14T15:01:00Z'));
  const html=renderPostingPage({posting:{...job,deadline:'2026-09-14'},others:[]});
  assert.ok(html.includes('<span class="badge closed">마감</span>'));
  assert.ok(!html.includes('"@type":"JobPosting"'));
});
