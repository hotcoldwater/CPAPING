"""Wake the analysis worker after persistence; the durable queue survives dispatch failures."""
import logging
import os
import requests
import time

log=logging.getLogger(__name__)
_last_dispatch=0.0

def dispatch_pending(db):
    global _last_dispatch
    if _last_dispatch and time.monotonic()-_last_dispatch<20:return False
    token=os.getenv('GH_ANALYSIS_TOKEN');repo=os.getenv('GITHUB_REPOSITORY')
    if not token or not repo:return False
    try:
        if not db._request('POST','rpc/career_analysis_pending',json={}):return False
        response=requests.post(f'https://api.github.com/repos/{repo}/actions/workflows/application-analysis.yml/dispatches',
            headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
            json={'ref':'main'},timeout=(5,10))
        response.raise_for_status();_last_dispatch=time.monotonic();log.info('미분석 공고 즉시 분석 요청');return True
    except Exception as exc:
        # The next crawler invocation rechecks outstanding work, including expired leases.
        log.warning('분석 시작 요청 보류 — 다음 수집에서 재시도: %s',type(exc).__name__);return False
