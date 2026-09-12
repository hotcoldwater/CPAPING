"""개인 OAuth 계정의 발송 API만 사용. 타임아웃 이후 자동 재발송 금지."""
import base64
import os
import html
import re
from email.message import EmailMessage
from email.policy import SMTP
import requests
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class MailError(RuntimeError): pass
class DeliveryUnknown(MailError): pass


def decrypt(user,value):
    iv,data=value.split('.')
    key=base64.b64decode(os.environ['MAIL_TOKEN_KEY'],validate=True)
    return AESGCM(key).decrypt(base64.b64decode(iv),base64.b64decode(data),user.encode()).decode()


def encrypt(user,value):
    iv=os.urandom(12);key=base64.b64decode(os.environ['MAIL_TOKEN_KEY'],validate=True)
    cipher=AESGCM(key).encrypt(iv,value.encode(),user.encode())
    return base64.b64encode(iv).decode()+'.'+base64.b64encode(cipher).decode()


def access(account,save_refresh):
    google=account['provider']=='google'
    prefix='GOOGLE_MAIL' if google else 'MICROSOFT_MAIL'
    token_url='https://oauth2.googleapis.com/token' if google else 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
    refresh=decrypt(account['user_id'],account['token_encrypted'])
    data={'client_id':os.environ.get(prefix+'_CLIENT_ID',''),'client_secret':os.environ.get(prefix+'_CLIENT_SECRET',''),
          'grant_type':'refresh_token','refresh_token':refresh}
    if not data['client_id'] or not data['client_secret']:raise MailError('개인 메일 연결 설정이 필요합니다.')
    try: r=requests.post(token_url,data=data,timeout=(10,30))
    except requests.RequestException as e: raise MailError('메일 인증 서버에 연결하지 못했습니다. 다시 연결해 주세요.') from e
    if not r.ok:raise MailError('개인 메일 권한이 만료되었거나 취소되었습니다. 다시 연결해 주세요.')
    tokens=r.json()
    if tokens.get('refresh_token') and tokens['refresh_token']!=refresh: save_refresh(encrypt(account['user_id'],tokens['refresh_token']))
    if not tokens.get('access_token'):raise MailError('메일 인증 응답을 확인하지 못했습니다.')
    return tokens['access_token']


def mime_message(app,account,file):
    msg=EmailMessage(policy=SMTP)
    for value in [app['recipient'],app['subject'],account['email']]:
        if '\r' in value or '\n' in value:raise MailError('메일 제목·주소에 줄바꿈이 있습니다.')
    msg['From']=account['email'];msg['To']=app['recipient'];msg['Subject']=app['subject']
    # Message-ID는 추적용. Gmail/Microsoft가 중복 제거한다고 가정하지 않는다.
    msg['Message-ID']=f'<career.{app["id"]}@cpaping.com>'
    msg.set_content(app['body'])
    tracking=app.get('tracking_url')
    if tracking:
        if not re.fullmatch(r'https://cpaping\.com/api/mail-open/[A-Za-z0-9_-]{43}\.gif',tracking):raise MailError('열람 확인 주소가 올바르지 않습니다.')
        content=html.escape(app['body']).replace('\n','<br>')
        msg.add_alternative('<html><body>'+content+'<p style="font-size:12px;color:#666">이 메일에는 열람 상태 확인을 위한 이미지가 포함되어 있습니다.</p><img src="'+tracking+'" width="1" height="1" alt=""></body></html>',subtype='html')
    major,minor=file['mime'].split('/',1)
    msg.add_attachment(base64.b64decode(file['data_base64']),maintype=major,subtype=minor,filename=file['name'])
    return msg.as_bytes()


def send(app,account,file,save_refresh):
    token=access(account,save_refresh)
    raw=mime_message(app,account,file)
    headers={'Authorization':'Bearer '+token}
    if account['provider']=='google':
        url='https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
        kwargs={'json':{'raw':base64.urlsafe_b64encode(raw).decode()}}
    else:
        url='https://graph.microsoft.com/v1.0/me/sendMail'
        headers['Content-Type']='text/plain'
        kwargs={'data':base64.b64encode(raw)}
    try: r=requests.post(url,headers=headers,timeout=(10,45),**kwargs)
    except requests.RequestException as e:raise DeliveryUnknown('발송 결과를 확인하지 못했습니다. 개인 메일의 보낸편지함을 확인해 주세요. 자동 재발송하지 않습니다.') from e
    if r.status_code>=500:raise DeliveryUnknown('메일 서비스의 접수 결과가 불확실합니다. 보낸편지함을 확인해 주세요. 자동 재발송하지 않습니다.')
    if not r.ok:raise MailError(f'메일 서비스가 발송을 거절했습니다 ({r.status_code}). 메일 연결과 한도를 확인해 주세요.')
    # Microsoft 202는 접수 성공이며 실제 수신·채용 접수 완료를 뜻하지 않는다.
    return r.json().get('id') if r.content else 'accepted'
