"""발송 전에 이력을 남긴다. 같은 지원서 버전/테스트 키는 중복 발송하지 않는다."""
import hashlib
import secrets
from datetime import datetime,timezone
from . import mail

def now():return datetime.now(timezone.utc).isoformat()

def deliver(db,app,account,file,save_refresh,mode='review',test_key=None):
    token=secrets.token_urlsafe(32)
    payload={'user_id':account['user_id'],'application_id':None if mode=='test' else app['id'],
             'application_version':None if mode=='test' else app['version'],'document_id':file['id'],
             'test_key':test_key,'company':app['company'],'recipient':app['recipient'],'subject':app['subject'],
             'body':app['body'],'mode':mode,'status':'sending','tracking_hash':hashlib.sha256(token.encode()).hexdigest()}
    # UNIQUE 제약이 재실행/동시 실행을 차단한다. 이력 저장 실패 시 발송하지 않는다.
    row=db.insert('career_mail_deliveries',payload)[0]
    try:
        message_id=mail.send({**app,'tracking_url':'https://cpaping.com/api/mail-open/'+token+'.gif'},account,file,save_refresh)
    except mail.DeliveryUnknown:
        db.update('career_mail_deliveries',{'status':'delivery_unknown','reason':'메일 서비스 접수 여부를 확인하지 못했습니다. 자동 재발송하지 않습니다.'},id='eq.'+row['id'])
        raise
    except mail.MailError:
        db.update('career_mail_deliveries',{'status':'failed','reason':'메일 인증 또는 발송 요청이 거절되었습니다.'},id='eq.'+row['id'])
        raise
    try:
        db.update('career_mail_deliveries',{'status':'sent','provider_message_id':message_id,'sent_at':now()},id='eq.'+row['id'])
    except Exception as e:
        # 공급자는 이미 접수했다. 이력을 못 고쳤다고 다시 보내지 않는다.
        raise mail.DeliveryUnknown('메일은 접수됐지만 이력 갱신을 확인하지 못했습니다. 자동 재발송하지 않습니다.') from e
    return message_id,row['id']
