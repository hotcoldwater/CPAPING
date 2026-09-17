"""Application transport policy. Resolve login identity server-side, never from a draft."""
import requests
from .mail import MailError
TEST_USER_ID='bbcfa2b9-9f2d-447b-84e1-68a55b776f71'
TEST_LOGIN='ohshsh00@gmail.com'
TEST_RECIPIENT='leorich21@naver.com'

def resolve(db, account, intended):
    if account['user_id']==TEST_USER_ID:return TEST_RECIPIENT
    try:
        response=requests.get(db.store.url+'/auth/v1/admin/users/'+account['user_id'],
            headers={'apikey':db.store.key,'Authorization':'Bearer '+db.store.key},timeout=20)
        response.raise_for_status();user=response.json()
        if user.get('id')!=account['user_id'] or not user.get('email'):raise ValueError()
    except Exception as exc:
        raise MailError('로그인 계정을 확인하지 못해 발송을 보류했습니다.') from exc
    return TEST_RECIPIENT if user['email'].strip().lower()==TEST_LOGIN else intended
