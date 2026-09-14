import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPostingContent } from '../web/posting-content.mjs';
const p={detail_url:'https://www.kicpa.or.kr/job?id=123',content_fetched_at:'2026-09-14T08:00:00Z'};
test('plain stored body is visible before rich-content backfill and remains escaped',()=>{
  const html=renderPostingContent({...p,body:'1. 지원 방법\n<script>alert(1)</script>'});
  assert.ok(html.includes('1. 지원 방법\n&lt;script&gt;'));assert.ok(!html.includes('<script>'));
});
test('renders images tables attachments and public contacts without executing source HTML',()=>{
  const html=renderPostingContent({...p,source_content:{version:1,nodes:[
    {tag:'h1',children:['모집 안내']},{tag:'pre',children:['한 줄\n두 줄']},
    {tag:'img',src:'https://www.kicpa.or.kr/poster.png',alt:'공고'},
    {tag:'table',children:[{tag:'tr',children:[{tag:'td',colspan:2,children:['감사']}]}]},
    {tag:'script',children:['bad()']},{tag:'img',src:'javascript:bad()'},
    {tag:'a',href:'data:text/html,bad',children:['안전한 텍스트']},
  ],contacts:[{label:'이메일',value:'jobs@example.com'}],attachments:[{name:'지원서.hwp',url:null},{name:'안내.pdf',url:'https://example.com/a.pdf'}]}});
  assert.ok(html.includes('<h3>모집 안내</h3>'));assert.ok(html.includes('한 줄\n두 줄'));
  assert.ok(html.includes('loading="lazy"'));assert.ok(html.includes('colspan="2"'));
  assert.ok(html.includes('원문에서 받기'));assert.ok(html.includes('파일 열기'));
  assert.ok(html.includes('mailto:jobs@example.com'));assert.ok(html.includes('17:00'));
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('javascript:'));assert.ok(!html.includes('data:text/html'));
});
test('missing body and invalid source version show honest fallback instead of invented content',()=>{
  const html=renderPostingContent({...p,source_content:{version:9,nodes:['invented']}});
  assert.ok(html.includes('아직 가져온 본문이 없습니다'));assert.ok(!html.includes('invented'));
});
