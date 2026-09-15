"""Read consenting users' application threads. Never send mail or render email HTML.

Conservative Korean result rules; uncertain replies need human confirmation.
Manual corrections are protected by an atomic, owner-scoped database RPC.
"""
import base64
import logging
import re
import time
from datetime import datetime, timezone
from email.utils import parseaddr
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup
from . import mail
from .runtime import now

log = logging.getLogger('replies')


def headers(message):
    result = {}
    for h in message.get('payload', {}).get('headers', []):
        result.setdefault(h['name'].lower(), h.get('value', ''))
    return result


def plain_body(payload):
    """Prefer plain text; remove HTML quotations, scripts, links and tracking images."""
    if payload.get('filename') or payload.get('mimeType', '').startswith('message/'):
        return ''
    parts = payload.get('parts', [])
    if parts:
        text = [(part.get('mimeType'), plain_body(part)) for part in parts]
        if payload.get('mimeType') == 'multipart/alternative':
            return next((body for mime, body in text if mime == 'text/plain' and body), next((body for _, body in text if body), ''))
        return '\n'.join(body for _, body in text if body)[:20000]
    if payload.get('mimeType') not in ('text/plain', 'text/html'):
        return ''
    encoded = payload.get('body', {}).get('data', '')
    if len(encoded) > 100000:
        return ''
    try:
        raw = base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4))
        content_type = next((h.get('value', '') for h in payload.get('headers', []) if h.get('name', '').lower() == 'content-type'), '')
        match = re.search(r'charset=["\']?([\w-]+)', content_type, re.I)
        charset = match[1] if match else 'utf-8'
        value = raw.decode(charset, errors='replace')
    except (ValueError, LookupError):
        return ''
    if payload.get('mimeType') == 'text/html':
        soup = BeautifulSoup(value, 'html.parser')
        for el in soup.select('script,style,blockquote,.gmail_quote,.yahoo_quoted,#divRplyFwdMsg'):
            el.decompose()
        value = soup.get_text('\n', strip=True)
    kept = []
    for line in value.splitlines():
        if re.match(r'^\s*(?:On .+wrote:|[-_]{3,}|보낸\s*사람\s*:|From\s*:|.*님이\s*작성\s*:)', line, re.I):
            break
        if not line.lstrip().startswith('>'):
            kept.append(line)
    return '\n'.join(kept).strip()[:20000]


def classify(subject, body):
    # Only actual body statements establish a result. Subjects/signatures are insufficient.
    compact = re.sub(r'\s+', '', body)
    if not compact or '\ufffd' in body or re.search(r'합격(?:여부|결과).{0,10}(?:문의|질문)|(?:최종|면접)(?:전형)?(?:결과|불합격|합격)|서류.{0,12}(?:발표예정|결과예정|심사중)', compact):
        return 'needs_review'
    # Conditional announcements, forwarded examples and negations are never definitive.
    if re.search(r'합격(?:하시면|할경우|한경우|자에게|자에한해|시에는)|(?:안내|통보|발표)(?:할|드릴)예정|합격이아|합격하지|통과하지|예시|전달받은|합격여부', compact):
        return 'needs_review'
    passed = bool(re.search(r'서류(?:전형|심사|평가)?(?:에|에서|을|를)?(?:최종)?(?:합격하셨|통과하셨|합격했|통과했|합격되셨|합격입니다|합격되었|합격을축하|통과를축하)|서류(?:전형|심사)?결과[:：]?(?:는)?합격(?:입니다|으로|을)', compact))
    rejected = bool(re.search(r'서류(?:전형|심사|평가)?(?:에|에서|결과)?[:：]?(?:는)?(?:불합격|탈락)(?:입니다|하셨|되셨|으로|했)|이번(?:채용|전형)(?:에서는|에서|에)?.{0,25}함께(?:하기|하지)어렵', compact))
    if passed and rejected:
        return 'needs_review'
    if rejected:
        return 'rejected'
    if passed:
        return 'passed'
    if re.search(r'(?:지원서|이력서|입사지원)(?:가|이|는|을|를)?.{0,12}(?:정상적으로|정상)?(?:접수되었|접수됐|접수하였|접수했습니다|접수완료|잘받았습니다)', compact):
        return 'received'
    return 'needs_review'


def evidence(message, original, delivery, account):
    h, sent = headers(message), headers(original)
    if message.get('id') == original.get('id') or set(message.get('labelIds', [])) & {'SENT', 'DRAFT', 'TRASH', 'SPAM'}:
        return None
    sender = parseaddr(h.get('from', ''))[1].lower()
    if not sender or sender == account['email'].lower():
        return None
    try:
        timestamp = int(message['internalDate'])
        if timestamp <= int(original['internalDate']):
            return None
    except (ValueError, KeyError, TypeError):
        return None
    original_id = sent.get('message-id', '').strip()
    references = re.findall(r'<[^<>\s]+>', h.get('in-reply-to', '') + ' ' + h.get('references', ''))
    if not original_id or original_id not in references:
        # Gmail may group messages with similar titles. Never infer linkage from thread alone.
        return None
    body = plain_body(message.get('payload', {}))
    auth = h.get('authentication-results', '')
    authenticated = auth.lower().startswith('mx.google.com;') and bool(re.search(r'\bdmarc=pass\b', auth, re.I))
    domain = sender.rsplit('@', 1)[-1]
    aligned = re.search(r'header\.from=' + re.escape(domain) + r'(?:[;\s]|$)', auth, re.I)
    strong_sender = sender == delivery['recipient'].lower() and authenticated and aligned
    result = classify(h.get('subject', ''), body) if strong_sender else 'needs_review'
    if h.get('auto-submitted', '').lower() == 'auto-replied' and result != 'received':
        result = 'needs_review'
    return {'p_message': message['id'], 'p_sender': sender, 'p_subject': h.get('subject', '')[:500],
            'p_excerpt': body[:2000], 'p_result': result,
            'p_received': datetime.fromtimestamp(timestamp / 1000, timezone.utc).isoformat()}


def gmail_get(token, path, **params):
    r = requests.get('https://gmail.googleapis.com/gmail/v1/users/me/' + path,
                     headers={'Authorization': 'Bearer ' + token}, params=params, timeout=(10, 25))
    if not r.ok:
        raise mail.MailError('답장 확인 권한을 확인하지 못했습니다. Gmail을 다시 연결해 주세요.' if r.status_code in (401, 403) else '답장 확인을 완료하지 못했습니다. 다음 작업에서 다시 확인합니다.')
    if len(r.content) > 5_000_000:
        raise mail.MailError('답장 내용이 너무 큽니다. Gmail에서 직접 확인해 주세요.')
    return r.json()


def sync_delivery(db, account, delivery, token):
    if not delivery.get('provider_message_id') or (delivery.get('sender_email') or '').lower() != account['email'].lower():
        return
    mid = quote(delivery['provider_message_id'], safe='')
    original = gmail_get(token, 'messages/' + mid, format='metadata', metadataHeaders=['Message-ID', 'From'])
    thread_id = original.get('threadId')
    if not thread_id:
        return
    thread = gmail_get(token, 'threads/' + quote(thread_id, safe=''), format='full')
    # Work from the actual sent provider ID, never the current resume or newest draft.
    for message in sorted(thread.get('messages', []), key=lambda m: int(m.get('internalDate') or 0)):
        value = evidence(message, original, delivery, account)
        if value:
            db.rpc('career_record_result', {'p_user': account['user_id'], 'p_delivery': delivery['id'],
                   'p_source': 'mail', 'p_connected': account['connected_at'], **value})
    db.update('career_mail_deliveries', {'reply_checked_at': now(), 'provider_thread_id': thread_id},
              id='eq.' + delivery['id'], user_id='eq.' + account['user_id'])


def process(db):
    deadline = time.monotonic() + 120
    accounts = db.rows('career_mail_accounts', provider='eq.google', reply_read_enabled='eq.true',
                       order='reply_checked_at.asc.nullsfirst,user_id.asc', limit=20)
    for account in accounts:
        if time.monotonic() >= deadline:
            break
        error = None
        try:
            deliveries = db.rows('career_mail_deliveries', user_id='eq.' + account['user_id'], status='eq.sent',
                                 mode='neq.test', sender_email='eq.' + account['email'], provider_message_id='not.is.null',
                                 order='reply_checked_at.asc.nullsfirst,id.asc', limit=10)
            if deliveries:
                def refresh(value):
                    db.update('career_mail_accounts', {'token_encrypted': value}, user_id='eq.' + account['user_id'], connected_at='eq.' + account['connected_at'])
                token = mail.access(account, refresh)
                for delivery in deliveries:
                    if time.monotonic() >= deadline:
                        break
                    try:
                        sync_delivery(db, account, delivery, token)
                    except Exception:
                        # Rotate failed/deleted messages as well, so one thread cannot starve all others.
                        db.update('career_mail_deliveries', {'reply_checked_at': now()}, id='eq.' + delivery['id'], user_id='eq.' + account['user_id'])
                        error = '일부 답장을 확인하지 못했습니다. Gmail 연결과 지원 메일을 확인해 주세요.'
        except Exception:
            error = '답장 확인을 완료하지 못했습니다. Gmail 연결을 확인해 주세요.'
        db.update('career_mail_accounts', {'reply_checked_at': now(), 'reply_sync_error': error},
                  user_id='eq.' + account['user_id'], connected_at='eq.' + account['connected_at'])
        if error:
            log.warning('개인 메일 답장 확인 미완료')
