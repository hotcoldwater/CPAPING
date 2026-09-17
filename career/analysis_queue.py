"""Event-driven public posting analysis. Retries and leases are persisted in the DB."""
import json
import logging
import os
import time
from datetime import datetime,timezone
from dotenv import load_dotenv
from . import requirements_ai as ai
from .runtime import DB,digest,source

log=logging.getLogger('analysis')

def analyze_once(post):
    original=source(post)
    text,missing=ai.bundle(original)
    if any('연결된 페이지 또는 첨부파일을 읽지 못했습니다' in m or '한공회 첨부파일을 읽지 못했습니다' in m for m in missing):
        raise ValueError(' '.join(missing)[:600])
    key=digest(ai.VERSION+'\n'+text+'\n'+json.dumps(missing,ensure_ascii=False))
    output=ai.call_ai([{'role':'system','content':ai.PROMPT},{'role':'user','content':text[:160000]}],3000,max_attempts=1,timeout_seconds=45)
    result=ai.validate(output,text,missing)
    result.update(evidence_hash=key,source_hash=digest(original))
    return result,original

def process(db,budget=360):
    start=time.monotonic();completed=0
    if os.getenv('CAREER_RESUME_ENABLED')=='true':
        from .resume_runner import match_new
        match_new(db)
    while time.monotonic()-start<budget:
        jobs=db.rpc('career_claim_analysis')
        if not jobs:
            pending=db.rows('career_analysis_jobs',status='eq.pending',order='available_at.asc',limit=1)
            if not pending:break
            delay=max(1,(datetime.fromisoformat(pending[0]['available_at'].replace('Z','+00:00'))-datetime.now(timezone.utc)).total_seconds())
            if delay>budget-(time.monotonic()-start):break
            time.sleep(min(5,delay));continue
        job=jobs[0];post=db.one('job_postings',id='eq.'+str(job['posting_id']));result=None;original=None;error=None
        try:
            if job['attempts']>3:raise ValueError('분석 작업이 중단되어 완료하지 못했습니다. 공고를 직접 확인해 주세요.')
            began=time.monotonic();result,original=analyze_once(post)
            log.info('공고 %s 분석 완료: %.1f초 (%s)',post['id'],time.monotonic()-began,result['state'])
        except Exception as exc:
            error=str(exc)[:600] if isinstance(exc,ValueError) else 'AI 또는 공고 원문 연결 중 일시적인 오류가 발생했습니다.'
            log.warning('공고 %s 분석 시도 %s 실패: %s',job['posting_id'],job['attempts'],type(exc).__name__)
        accepted=db.rpc('career_finish_analysis',{'p_posting':job['posting_id'],'p_lease':job['lease'],'p_result':result,'p_error':error})
        if accepted and (result or job['attempts']>=3):
            completed+=1
            if os.getenv('CAREER_RESUME_ENABLED')=='true':
                from .resume_runner import prepare_pending
                prepare_pending(db,posting_id=job['posting_id'],original=original)
                from .dispatch import wake_delivery
                wake_delivery(db)
    return completed

def main():
    load_dotenv();logging.basicConfig(level=logging.INFO)
    log.info('분석 완료 %s건',process(DB()))

if __name__=='__main__':main()
