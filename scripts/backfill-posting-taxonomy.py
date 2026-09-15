"""Backfill captured public postings without triggering application/notification delivery.

Prepare: python scripts/backfill-posting-taxonomy.py --cache /path/to/capture
Apply reviewed plan: add --apply. Existing delivery fields and user settings are untouched.
"""
import argparse,json,sys,collections
from pathlib import Path
from datetime import date
from dataclasses import fields
from dotenv import load_dotenv
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'crawler'))
import kicpa,store,classify
from taxonomy import taxonomy_row

def posting(data):
    p=kicpa.Posting(**{k:v for k,v in data.items() if k in {f.name for f in fields(kicpa.Posting)}})
    for key in ('posted_at','deadline'):
        v=getattr(p,key)
        if isinstance(v,str):setattr(p,key,date.fromisoformat(v))
    return p

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--cache',required=True,type=Path);parser.add_argument('--apply',action='store_true');parser.add_argument('--archive',type=Path,help='Optional historical detail HTML directory, named by DB id');args=parser.parse_args()
    load_dotenv(ROOT/'.env');db=store.Store()
    existing=[]
    for offset in range(0,1000000,1000):
        rows=db._request('GET','job_postings',params={'select':'*','order':'id.asc','limit':'1000','offset':str(offset)})
        existing.extend(rows)
        if len(rows)<1000:break
    known={(r['source'],r['ij_id']):r for r in existing}
    inv=json.loads((args.cache/'inventory.json').read_text());current={};inserts=[];patches=[]
    for entry in inv:
        path=args.cache/'details'/f"{entry['board']}-{entry['ij_id']}.json"
        p=posting(json.loads(path.read_text()));assert p.detail_fetched and p.source_content is not None
        current[(p.source,p.ij_id)]=p
        if (p.source,p.ij_id) not in known:
            classify.classify(p);row=store.to_row(p)
            # Historical imports must never enter existing auto-send or notification queues.
            row['is_target']=False;row['notified_at']=store._now_iso();inserts.append(row)
    for row in existing:
        key=(row['source'],row['ij_id'])
        if key in current:p=current[key]
        else:
            p=posting({**row,'board':row['source'].split(':')[-1]})
            snapshot=args.archive/f"{row['id']}.html" if args.archive else None
            if snapshot and snapshot.exists():
                try:kicpa.parse_detail(snapshot.read_text(),p)
                except ValueError:pass
        values=taxonomy_row(p)
        if key in current:
            values.update(store.content_row(p),deadline=p.deadline.isoformat() if p.deadline else None,
                          removed_at=None,is_expired=classify.is_expired(p),hiring_status=p.hiring_status or None)
        patches.append({'id':row['id'],'values':values})
    counts=collections.Counter(k for r in inserts for k in r['recruitment_categories'])
    counts.update(k for r in patches for k in r['values']['recruitment_categories'])
    summary={'existing':len(existing),'accessible':len(inv),'insert':len(inserts),'update':len(patches),'category_memberships':dict(counts),
             'needs_review':sum(r['taxonomy_needs_review'] for r in inserts)+sum(r['values']['taxonomy_needs_review'] for r in patches)}
    (args.cache/'before.json').write_text(json.dumps(existing,ensure_ascii=False))
    (args.cache/'plan.json').write_text(json.dumps({'summary':summary,'inserts':inserts,'patches':patches},ensure_ascii=False))
    print(json.dumps(summary,ensure_ascii=False),flush=True)
    if args.apply:
        for start in range(0,len(inserts),100):
            # Ignore concurrent crawler inserts rather than replacing their delivery state.
            db._request('POST','job_postings',params={'on_conflict':'source,ij_id'},headers={'Prefer':'resolution=ignore-duplicates,return=minimal'},json=inserts[start:start+100])
        for patch in patches:db._request('PATCH','job_postings',params={'id':f"eq.{patch['id']}"},json=patch['values'])
        print('APPLIED: public metadata only; historical new rows excluded from deliveries',flush=True)

if __name__=='__main__':main()
