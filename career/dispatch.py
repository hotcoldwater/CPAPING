"""Best-effort immediate wake; the independent minute timer repairs missed requests."""
import logging,os,time,requests
_last=0.0
def wake_delivery(db):
    global _last
    token=os.getenv('GH_DELIVERY_TOKEN');repo=os.getenv('GITHUB_REPOSITORY')
    if os.getenv('CAREER_SEND_ENABLED')!='true' or not token or not repo:return False
    if _last and time.monotonic()-_last<5:return False
    try:
        if not db.rows('career_applications',status='eq.queued',deleted_at='is.null',limit=1,select='id',**{'snapshot->>flow':'eq.uploaded-resume-v1'}):return False
        response=requests.post(f'https://api.github.com/repos/{repo}/actions/workflows/delivery.yml/dispatches',headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'},json={'ref':'main'},timeout=(5,8))
        response.raise_for_status();_last=time.monotonic();return True
    except Exception:
        logging.getLogger('delivery').warning('즉시 발송 실행 요청 실패 — 1분 점검에서 복구');return False
