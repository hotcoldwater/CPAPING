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
test('notification eligibility freezes legacy recipients and captures both types for new jobs',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create table job_postings(id bigint primary key,employment_type text,work_types text[],body text,first_seen_at timestamptz,notified_at timestamptz);
 insert into job_postings values (1,'Full Time',array['full_time','part_time'],'old','2026-09-01','2026-09-02'),(2,'Part Time',array['part_time'],'old','2026-09-01',null);`);
 const sql=readFileSync('db/migrations/031_notification_work_types.sql','utf8');await db.exec(sql);await db.exec(sql);
 assert.deepEqual((await db.query('select notification_work_types from job_postings order by id')).rows.map(r=>r.notification_work_types),[['full_time'],['part_time']]);
 await db.exec(`insert into job_postings(id,employment_type,work_types) values(3,'Full Time',array['full_time','part_time']);
 update job_postings set body='기타정보',work_types=array['full_time','part_time'] where id=1;
 insert into job_postings(id,employment_type,work_types) values(1,'Full Time',array['full_time','part_time']) on conflict(id) do update set work_types=excluded.work_types;`);
 assert.deepEqual((await db.query('select id from job_postings where notification_work_types @> array[\'part_time\'] order by id')).rows.map(r=>r.id),[2,3]);
 assert.deepEqual((await db.query('select id from job_postings where notification_work_types @> array[\'full_time\'] order by id')).rows.map(r=>r.id),[1,3]);
 assert.equal((await db.query('select notified_at is not null as sent from job_postings where id=1')).rows[0].sent,true);
 }finally{await db.close();}
});
