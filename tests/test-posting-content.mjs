import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPostingPage } from '../web/posting-page.mjs';
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
test('public posting details hide analysis for pending, classified and uncertain results',()=>{
 for(const application_analysis of [null,{state:'classified',documents:{kind:'designated'},subject:{kind:'free'},method:'email'},{state:'needs_confirmation',uncertainty:['지원 이메일 확인 필요']}]){
  const html=renderPostingPage({posting:{id:1,ij_id:'123',title:'채용',company_name:'예시',application_analysis}});
  assert.doesNotMatch(html,/analysis-status|analysis-facts|application_analysis|AI 분석 중|지원 이메일 확인 필요|제목양식|파일제목/);
  assert.match(html,/공고 요약/);
 }
});
test('other info is separate, escaped, ordered before contacts, and absent when empty',()=>{
 const base={version:1,nodes:['본문'],contacts:[{label:'이메일',value:'jobs@example.com'}]};
 const html=renderPostingContent({...p,source_content:{...base,other_nodes:[{tag:'pre',children:['전형방법\n급여 <조건>']},{tag:'script',children:['attack()']}]}});
 assert.match(html,/id="posting-other-title">기타정보/);assert.match(html,/전형방법\n급여 &lt;조건&gt;/);
 assert.ok(html.indexOf('본문')<html.indexOf('기타정보'));assert.ok(html.indexOf('기타정보')<html.indexOf('지원·문의'));
 assert.ok(!html.includes('attack()'));
 for(const other_nodes of [undefined,[],['  '],[{tag:'p',children:[{tag:'br'}]}]]){
  assert.ok(!renderPostingContent({...p,source_content:{...base,other_nodes}}).includes('posting-other-title'));
 }
 assert.match(renderPostingContent({...p,source_content:{...base,other_nodes:[{tag:'img',src:'https://example.com/extra.png'}]}}),/posting-other-title/);
});
