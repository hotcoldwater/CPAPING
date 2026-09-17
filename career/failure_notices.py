"""Transactional failure outbox; one immutable payload and delivery key per event."""
import os,logging
from datetime import datetime,timedelta,timezone
import requests
from .runtime import now
from .review_notices import verified_email

def process(db):
    if not os.getenv('RESEND_API_KEY'):return
    cutoff=(datetime.now(timezone.utc)-timedelta(minutes=10)).isoformat()
    for n in db.rows('career_failure_notices',order='created_at.asc',limit=20,**{'or':f'(status.eq.pending,and(status.eq.sending,claimed_at.lt.{cutoff}))'}):
        try:
            if n.get('claimed_at') and datetime.fromisoformat(n['claimed_at'])<datetime.now(timezone.utc)-timedelta(hours=23):
                db.update('career_failure_notices',{'status':'unknown'},id='eq.'+n['id']);continue
            app=db.one('career_applications',id='eq.'+n['application_id'])
            if not app or app.get('deleted_at') or app.get('status') not in ('blocked','failed','delivery_unknown') or app.get('manual_status') not in (None,'blocked'):
                db.update('career_failure_notices',{'status':'cancelled'},id='eq.'+n['id']);continue
            payload=n.get('payload')
            if not payload:
                event=db.one('career_application_events',id='eq.'+n['event_id'])
                email=verified_email(db,n['user_id'])
                if not email:db.update('career_failure_notices',{'status':'cancelled'},id='eq.'+n['id']);continue
                company=' '.join((event['snapshot'].get('company') or '공고').split())[:100]
                payload={'from':os.getenv('MAIL_FROM') or 'CPAPING <noreply@cpaping.com>','to':[email],
                    'subject':f'[CPAPING] {company} 지원 확인이 필요합니다',
                    'text':f"자동지원을 완료하지 못했습니다.\n\n이유: {event.get('reason') or '지원 요건 확인 필요'}\n\n지원현황에서 메일과 첨부파일을 수정해 발송하거나, 공고의 지원 사이트에서 직접 접수해 주세요.\nhttps://cpaping.com/applications/?review={n['application_id']}\n\n공고 원문: {event['snapshot'].get('detail_url') or '지원현황에서 확인'}\n자동으로 재발송하지 않습니다."}
            claimed=db.update('career_failure_notices',{'status':'sending','payload':payload,'claimed_at':n.get('claimed_at') or now()},id='eq.'+n['id'],status='eq.'+n['status'])
            if not claimed:continue
            try:
                r=requests.post('https://api.resend.com/emails',headers={'Authorization':'Bearer '+os.environ['RESEND_API_KEY'],'Idempotency-Key':'failure-'+n['id']},json=payload,timeout=30)
                status='sent' if r.ok else 'pending' if r.status_code>=500 or r.status_code==429 else 'failed'
            except requests.RequestException:status='pending'
            db.update('career_failure_notices',{'status':status,**({'sent_at':now()} if status=='sent' else {})},id='eq.'+n['id'],status='eq.sending')
        except Exception:logging.getLogger('career').warning('지원 실패 안내를 다음 실행에서 재확인합니다.')
