import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire('/tmp/cpaping-career-qa/package.json');const {PGlite}=require('@electric-sql/pglite');
test('taxonomy migration preserves posting identities and legacy delivery flags and is repeatable',async()=>{
 const db=new PGlite();try{
 await db.exec(`create table job_postings(id bigint primary key,source text,is_target boolean,first_seen_at timestamptz,notified_at timestamptz);insert into job_postings values (1,'kicpa:trainee',true,'2026-01-01','2026-01-02'),(2,'kicpa:cpa',false,'2026-01-03',null);`);
 const before=(await db.query('select * from job_postings order by id')).rows;
 const sql=readFileSync('db/migrations/024_posting_taxonomy.sql','utf8');await db.exec(sql);await db.exec(sql);
 const after=(await db.query('select id,source,is_target,first_seen_at,notified_at from job_postings order by id')).rows;assert.deepEqual(after,before);
 assert.deepEqual((await db.query('select recruitment_categories from job_postings')).rows.map(x=>x.recruitment_categories),[[],[]]);
 }finally{await db.close();}
});
