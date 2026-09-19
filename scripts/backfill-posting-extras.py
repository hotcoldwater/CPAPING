"""Refresh open entry-CPA documents and work types without changing delivery eligibility."""
import argparse
import json
import re
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'crawler'))
from kicpa import Posting, fetch_detail, make_session
from store import Store, content_row, kst_today
from taxonomy import work_types


def company_key(name):
    return re.sub(r'\s+B\.?V\.?$', '', str(name or '').strip(), flags=re.I)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='/tmp/cpaping-posting-extras-plan.json')
    parser.add_argument('--apply-from')
    args = parser.parse_args()
    load_dotenv(ROOT / '.env')
    db = Store()
    # The snapshot column must be installed before applying changes to old jobs.
    fields = 'id,ij_id,source,title,company_name,employment_type,body,source_content,content_fetched_at,work_types,first_seen_at,notified_at'
    rows = db._request('GET', 'job_postings', params={
        'select': fields, 'recruitment_categories':'cs.{entry_cpa}',
        'removed_at':'is.null', 'is_expired':'is.false',
        'or':f'(deadline.is.null,deadline.gte.{kst_today()})', 'order':'id.asc', 'limit':'1000',
    })
    by_id = {r['id']:r for r in rows}
    if args.apply_from:
        db._request('GET','job_postings',params={'select':'notification_work_types','limit':'0'})
        plan = json.loads(Path(args.apply_from).read_text())
        updated = skipped = 0
        for entry in plan:
            row = by_id.get(entry['id'])
            if entry['status'] != 'ready' or not row:
                skipped += 1
                continue
            if row['source'] != entry['source'] or row['ij_id'] != entry['ij_id']:
                raise ValueError('공고 식별자 불일치')
            original = entry['before']
            # Compare the document at preparation time; never overwrite a newer refresh.
            if any(row.get(k) != original.get(k) for k in ('source_content','body','work_types','content_fetched_at')):
                skipped += 1
                continue
            stamp = row.get('content_fetched_at')
            changed = db._request('PATCH','job_postings',params={
                'id':f'eq.{row["id"]}', 'removed_at':'is.null','is_expired':'is.false',
                'content_fetched_at':f'eq.{stamp}' if stamp else 'is.null',
                'select':'id,first_seen_at,notified_at',
            }, headers={'Prefer':'return=representation'}, json=entry['changes'])
            if changed:
                assert changed[0]['first_seen_at'] == row['first_seen_at']
                assert changed[0]['notified_at'] == row['notified_at']
                updated += 1
            else: skipped += 1
        print(json.dumps({'updated':updated,'skipped':skipped,'mail_sent':0}),flush=True)
        return
    plan = []
    with make_session() as session:
        for row in rows:
            entry = {'id':row['id'],'ij_id':row['ij_id'],'source':row['source'],'company':row['company_name'],'before':row}
            try:
                p = Posting(board=row['source'].split(':')[1],ij_id=row['ij_id'],title=row['title'],company_name=row['company_name'],employment_type=row['employment_type'] or '')
                fetch_detail(session,p)
                if company_key(p.company_name) != company_key(row['company_name']):
                    raise ValueError('공고 회사명 불일치')
                entry.update(status='ready',changes={**content_row(p),'work_types':work_types(p)})
            except Exception as exc:
                entry.update(status='failed',error=type(exc).__name__)
            plan.append(entry)
            Path(args.output).write_text(json.dumps(plan,ensure_ascii=False,indent=2))
            print(json.dumps({'prepared':len(plan),'total':len(rows),'company':entry['company'],'status':entry['status']},ensure_ascii=False),flush=True)
            time.sleep(1)
    print(json.dumps({'ready':sum(r['status']=='ready' for r in plan),'total':len(plan),'output':args.output}),flush=True)

if __name__ == '__main__': main()
