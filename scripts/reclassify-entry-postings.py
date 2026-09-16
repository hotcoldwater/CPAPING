"""Refresh entry eligibility without re-enabling historical notification queues."""
import argparse,json,sys
from pathlib import Path
from types import SimpleNamespace
from dotenv import load_dotenv
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'crawler'))
from taxonomy import taxonomy_row
from store import Store

def plan(rows):
    patches=[];count=0
    for row in rows:
        p=SimpleNamespace(**{**row,'board':row['source'].split(':')[-1],
            'co_sep':row.get('company_type'),'recruit_type':row.get('source_recruit_type')})
        values=taxonomy_row(p);eligible='entry_cpa' in values['recruitment_categories'];count+=eligible
        patch={}
        if values['recruitment_categories']!=row.get('recruitment_categories'):
            patch={k:values[k] for k in ('recruitment_categories','taxonomy_version','taxonomy_reason','taxonomy_needs_review')}
        # Narrow the old queue. Never turn imported historical rows back on.
        if not eligible and row.get('is_target'):patch['is_target']=False
        if patch:patches.append({'id':row['id'],'title':row['title'],'before':{k:row.get(k) for k in patch},'values':patch})
    return {'total':len(rows),'entry':count,'patches':patches}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');parser.add_argument('--audit',required=True,type=Path);args=parser.parse_args()
    load_dotenv(ROOT/'.env');db=Store();rows=[]
    for offset in range(0,1000000,1000):
        batch=db._request('GET','job_postings',params={'select':'*','order':'id.asc','limit':'1000','offset':str(offset)})
        rows.extend(batch)
        if len(batch)<1000:break
    result=plan(rows);args.audit.write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps({'total':result['total'],'entry':result['entry'],'patches':len(result['patches']),'re_enabled_notifications':0}))
    if args.apply:
        for patch in result['patches']:db._request('PATCH','job_postings',params={'id':f"eq.{patch['id']}"},json=patch['values'])
        print('Applied eligibility and disabled out-of-scope queues. No messages sent.')
if __name__=='__main__':main()
