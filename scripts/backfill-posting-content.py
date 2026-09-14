"""Prepare/review public source snapshots; --apply-from updates content only, never sends mail."""
import argparse, json, sys, time
from pathlib import Path
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'crawler'))
from kicpa import Posting, make_session, fetch_detail
from store import Store

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',default='/tmp/cpaping-posting-content-backfill.json')
    parser.add_argument('--apply-from')
    args=parser.parse_args()
    load_dotenv(ROOT/'.env');db=Store()
    rows=db._request('GET','job_postings',params={'select':'ij_id,source,company_name,posted_at','source':'in.(kicpa:trainee,kicpa:cpa)','order':'posted_at.desc','limit':'1000'})
    existing={(r['source'],r['ij_id']) for r in rows}
    if args.apply_from:
        plan=json.loads(Path(args.apply_from).read_text())
        count=0
        for r in plan:
            if r.get('status')!='ready':continue
            if (r['source'],r['ij_id']) not in existing:raise ValueError('공고가 현재 DB에 없습니다')
            if r['source_content'].get('version')!=1:raise ValueError('지원하지 않는 본문 구조')
            db._request('PATCH','job_postings',params={'source':f'eq.{r["source"]}','ij_id':f'eq.{r["ij_id"]}'},
              json={k:r[k] for k in ['body','source_content','content_fetched_at']})
            count+=1
        print(json.dumps({'updated':count,'skipped':len(plan)-count,'mail_sent':0}),flush=True)
        return
    def collect(row):
        result=dict(row)
        try:
            p=Posting(board=row['source'].split(':')[1],ij_id=row['ij_id'])
            with make_session() as session:fetch_detail(session,p)
            if p.source_content is None:raise ValueError('source content missing')
            if not p.company_name or p.company_name.strip()!=str(row['company_name'] or '').strip():raise ValueError('source company mismatch')
            result.update(status='ready',body=p.body or None,source_content=p.source_content,content_fetched_at=datetime.now(timezone.utc).isoformat())
        except Exception as exc:result.update(status='failed',error=type(exc).__name__)
        time.sleep(.6)
        return result
    out=[]
    with ThreadPoolExecutor(max_workers=2) as pool:
        for future in as_completed([pool.submit(collect,row) for row in rows]):
            out.append(future.result())
            Path(args.output).write_text(json.dumps(out,ensure_ascii=False,indent=2))
            if len(out)%15==0 or len(out)==len(rows):print(json.dumps({'prepared':len(out),'total':len(rows),'ready':sum(r['status']=='ready' for r in out)}),flush=True)
    print(json.dumps({'output':args.output,'ready':sum(r['status']=='ready' for r in out),'failed':[{'id':r['ij_id'],'error':r['error']} for r in out if r['status']=='failed']}),flush=True)

if __name__=='__main__':main()
