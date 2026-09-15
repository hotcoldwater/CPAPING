import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import '../web/posting-taxonomy.js';import {renderPostingPage} from '../web/posting-page.mjs';import {POSTING_SCOPE} from '../web/posting-data.mjs';
const require=createRequire('/tmp/cpaping-career-qa/package.json'),{JSDOM}=require('jsdom');
const posts=[
 {id:1,ij_id:'1',source:'kicpa:trainee',company_name:'예시회계법인',title:'수습 모집',company_type:'회계법인',recruitment_categories:['entry_cpa'],region:'서울',work_types:['full_time'],career:'신입',form_type:'designated'},
 {id:2,ij_id:'2',source:'kicpa:cpa',company_name:'기관',title:'경력 모집',company_type:'공공기관',recruitment_categories:['experienced_cpa'],region:'부산',deadline:'2000-01-01'},
 {id:3,ij_id:'3',source:'kicpa:cpa',company_name:'일반기업',title:'담당자',company_type:'일반기업',recruitment_categories:['general'],region:'서울',cpa_preferred:true},
 {id:4,ij_id:'4',source:'kicpa:cpa',company_name:'예시회계법인',title:'신입 경력 모집',company_type:'회계법인',recruitment_categories:['entry_cpa','experienced_cpa'],region:'부산'},
 {id:5,ij_id:'5',source:'kicpa:association',company_name:'한국공인회계사회',title:'채용',recruitment_categories:[]},
];
test('list tabs, multiple filters, reset and closed jobs work without deadlines',()=>{
 const dom=new JSDOM(readFileSync('web/index.html','utf8'),{url:'https://cpaping.com/',runScripts:'outside-only'}),w=dom.window;
 try{
  w.eval(readFileSync('web/posting-taxonomy.js','utf8'));
  const script=[...w.document.scripts].find(s=>s.textContent.includes('const SUPABASE_URL')).textContent;
  w.eval(script.replace('load();',''));
  w.eval('load()');w.eval('render('+JSON.stringify(posts)+')');
  const d=w.document,tab=label=>[...d.querySelectorAll('#filters button')].find(x=>x.textContent.startsWith(label));
  assert.equal(d.querySelectorAll('#rows>.row').length,4);assert.match(d.querySelector('#rows').textContent,/마감일 확인/);
  tab('신입 CPA').click();assert.equal(d.querySelectorAll('#rows>.row').length,2);
  const seoul=d.querySelector('#facet-location input[value="서울"]');seoul.click();assert.equal(d.querySelectorAll('#rows>.row').length,1);
  d.querySelector('#facet-location input[value="부산"]').click();assert.equal(d.querySelectorAll('#rows>.row').length,2);
  d.querySelector('#reset-filters').click();tab('경력 CPA').click();assert.equal(d.querySelectorAll('#rows>.row').length,1);
  d.querySelector('#include-closed').click();assert.equal(d.querySelectorAll('#rows>.row').length,2);assert.match(d.querySelector('#rows').textContent,/마감/);
  d.querySelector('#reset-filters').click();tab('일반 채용').click();assert.match(d.querySelector('#rows').textContent,/CPA 우대/);
  d.querySelector('#facet-company_type input[value="회계법인"]').click();assert.equal(d.querySelector('#empty').hidden,false);assert.equal(d.querySelector('#controls').hidden,false);
  d.querySelector('#empty-reset').click();assert.equal(d.querySelectorAll('#rows>.row').length,4);
 }finally{w.close();}
});
test('confirmed duplicate keeps history and different work conditions stay separate',()=>{
 const base={...posts[0],posted_at:'2026-09-01',employment_type:'Full Time'};
 const later={...base,id:6,ij_id:'6',original_id:1,posted_at:'2026-09-15'};
 let grouped=globalThis.cpPosting.groupPostings([base,later]);assert.equal(grouped.length,1);assert.equal(grouped[0].id,6);assert.equal(grouped[0].history[0].id,1);
 grouped=globalThis.cpPosting.groupPostings([base,{...later,employment_type:'Part Time'}]);assert.equal(grouped.length,2);
});
test('detail uses actual taxonomy and never equates full time with permanent contract',()=>{
 const html=renderPostingPage({posting:{...posts[0],employment_type:'Full Time',contract_types:['계약직']},others:[]});
 assert.match(html,/신입 CPA/);assert.match(html,/풀타임/);assert.match(html,/계약직/);assert.ok(!html.includes('정규직'));
 const general=renderPostingPage({posting:posts[2],others:[]});assert.match(general,/일반 채용/);assert.ok(!general.includes('경력 회계사 공고'));
 assert.ok(!POSTING_SCOPE.includes('is_target'));assert.match(POSTING_SCOPE,/association/);
});
