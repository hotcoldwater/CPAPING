"""Send one approval invitation per application, using a durable, idempotent outbox.

The link only opens an authenticated review page. GET never approves or sends.
No mailbox data or resume contents are sent through this notification channel.
"""
import logging
import os
from datetime import datetime, timedelta, timezone

import requests

from .runtime import now

log = logging.getLogger('career')


def invitation(application, recipient):
    company = application.get('snapshot', {}).get('company') or '선택한 법인'
    # Prevent source text from introducing mail headers; JSON API handles encoding.
    company = ' '.join(company.split())[:120]
    return {
        'from': os.getenv('MAIL_FROM') or 'CPAPING <noreply@cpaping.com>',
        'to': [recipient],
        'subject': f'[CPAPING] {company}에 지원서를 보낼까요?',
        'text': (f'{company}의 새 공고에 맞춰 지원서를 준비했습니다.\n\n'
                 '아래 링크에서 로그인한 뒤 수신자·메일·첨부파일과 공고의 제출 요건을 확인해 주세요.\n'
                 '「발송」를 눌러야 담당자에게 발송됩니다. 링크를 열기만 해서는 발송되지 않습니다.\n\n'
                 f'https://cpaping.com/applications/?review={application["id"]}\n\n'
                 '자동 지원은 지원준비 화면에서 끌 수 있습니다.'),
        'reply_to': 'contact@cpaping.com',
    }


def verified_email(db, user_id):
    r = requests.get(db.store.url + '/auth/v1/admin/users/' + user_id,
                     headers={'apikey': db.store.key, 'Authorization': 'Bearer ' + db.store.key}, timeout=20)
    r.raise_for_status()
    user = r.json()
    return user.get('email') if user.get('email_confirmed_at') else None


def deliver_notice(db, notice):
    app = db.one('career_applications', id='eq.' + notice['application_id'])
    rule = db.one('career_rules', user_id='eq.' + notice['user_id'])
    if not app or app.get('deleted_at') or app['status'] != 'review' or app.get('manual_status') not in (None,'review') or not rule or not rule.get('enabled'):
        db.update('career_review_notices', {'status': 'cancelled'}, application_id='eq.' + notice['application_id'])
        return
    # Resend remembers idempotency keys for 24h. Never retry beyond that window.
    claimed = notice.get('claimed_at')
    if claimed and datetime.fromisoformat(claimed) < datetime.now(timezone.utc) - timedelta(hours=23):
        db.update('career_review_notices', {'status': 'unknown'}, application_id='eq.' + notice['application_id'])
        return
    payload = notice.get('payload')
    if not payload:
        recipient = verified_email(db, notice['user_id'])
        if not recipient:
            db.update('career_review_notices', {'status': 'cancelled'}, application_id='eq.' + notice['application_id'])
            return
        payload = invitation(app, recipient)
    rows = db.update('career_review_notices', {'status': 'sending', 'payload': payload, 'claimed_at': claimed or now()},
                     application_id='eq.' + notice['application_id'], status='eq.' + notice['status'])
    if not rows:
        return
    try:
        r = requests.post('https://api.resend.com/emails', headers={
            'Authorization': 'Bearer ' + os.environ['RESEND_API_KEY'],
            'Content-Type': 'application/json',
            'Idempotency-Key': 'review-notice-' + notice['application_id'],
        }, json=payload, timeout=30)
        status = 'sent' if r.ok else 'pending' if r.status_code >= 500 or r.status_code == 429 else 'failed'
    except requests.RequestException:
        status = 'pending'  # Same persisted payload and idempotency key on retry.
    db.update('career_review_notices', {'status': status, **({'sent_at': now()} if status == 'sent' else {})},
              application_id='eq.' + notice['application_id'], status='eq.sending')


def process(db):
    if not os.getenv('RESEND_API_KEY'):
        log.warning('검수 안내 메일 설정이 없어 안내를 보류합니다.')
        return
    # Query the private outbox with an anti-join so old sent notices cannot starve new ones.
    for app in db.rpc('career_pending_review_notices'):
        db.store._request('POST', 'career_review_notices', json={'application_id': app['id'], 'user_id': app['user_id']},
                          headers={'Prefer': 'resolution=ignore-duplicates,return=minimal'})
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    for notice in db.rows('career_review_notices',
                         order='created_at.asc', limit=10,
                         **{'or': f'(status.eq.pending,and(status.eq.sending,claimed_at.lt.{cutoff}))'}):
        try:
            deliver_notice(db, notice)
        except Exception:
            # Never log source text, user email, provider responses, or credentials.
            log.warning('검수 안내를 완료하지 못했습니다. 다음 실행에서 다시 확인합니다.')
