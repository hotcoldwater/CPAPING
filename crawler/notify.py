"""이메일 발송.

구독자에게 나가는 메일은 **Resend** 로 보낸다. Gmail SMTP 로 보내면
발신자에 운영자 개인 주소가 그대로 찍혀 모든 구독자에게 노출된다.
도메인 인증(SPF·DKIM)이 걸린 주소로 보내야 스팸함에도 덜 들어간다.

관리자 장애 알림만 Gmail SMTP 를 예비로 남겨 둔다. Resend 자체가 죽으면
그 사실을 알릴 길이 없어지기 때문이다. 이 경로에는 구독자 정보가 실리지
않으므로 개인정보처리방침의 수탁자와는 무관하다.
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl

import requests
from email.message import EmailMessage
from email.utils import formataddr

log = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
SENDER_NAME = "CPAPING"

RESEND_URL = "https://api.resend.com/emails"
DEFAULT_FROM = "CPAPING <noreply@cpaping.com>"
# 답장이 곧 피드백이 되도록. 사이트로 돌아올 필요가 없다.
REPLY_TO = "contact@cpaping.com"

# 파이썬을 python.org 설치본으로 쓰면 CA 인증서가 없을 수 있다.
# certifi 가 있으면 그것을 쓰고, 없으면 macOS 시스템 번들로 넘어간다.
_CA_FALLBACKS = ("/etc/ssl/cert.pem", "/private/etc/ssl/cert.pem")


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        for path in _CA_FALLBACKS:
            if os.path.exists(path):
                return ssl.create_default_context(cafile=path)
        return ssl.create_default_context()


def send_mail(subject: str, text_body: str, html_body: str | None = None,
              to: str | None = None, extra_headers: dict | None = None) -> None:
    """구독자에게 메일 1통 발송 (Resend). 실패하면 예외를 그대로 올린다."""
    api_key = os.environ.get("RESEND_API_KEY", "")
    recipient = to or os.environ.get("CPAPING_MAIL_TO", "")
    if not api_key:
        raise RuntimeError(
            "RESEND_API_KEY 가 없습니다. GitHub Secrets 와 .env 를 확인하세요."
        )
    if not recipient:
        raise RuntimeError("받는 주소가 없습니다.")

    payload = {
        "from": os.environ.get("MAIL_FROM") or DEFAULT_FROM,
        "to": [recipient],
        "subject": subject,
        "text": text_body,
        "reply_to": REPLY_TO,
    }
    if html_body:
        payload["html"] = html_body
    if extra_headers:
        payload["headers"] = extra_headers

    res = requests.post(
        RESEND_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    if not res.ok:
        raise RuntimeError(f"Resend {res.status_code}: {res.text[:300]}")

    log.info("메일 발송: %s → %s", subject, recipient)


def send_mail_smtp(subject: str, text_body: str, to: str | None = None) -> None:
    """Gmail SMTP 직접 발송. 관리자 장애 알림 예비 경로로만 쓴다."""
    user = os.environ.get("CPAPING_SMTP_USER", "")
    password = os.environ.get("CPAPING_SMTP_APP_PASSWORD", "").replace(" ", "")
    recipient = to or os.environ.get("CPAPING_MAIL_TO", "")

    if not (user and password and recipient):
        raise RuntimeError(
            "CPAPING_SMTP_USER / CPAPING_SMTP_APP_PASSWORD / CPAPING_MAIL_TO "
            "가 필요합니다. .env 를 확인하세요."
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((SENDER_NAME, user))
    msg["To"] = recipient
    msg.set_content(text_body)

    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=_ssl_context(), timeout=30) as smtp:
        smtp.login(user, password)
        smtp.send_message(msg)

    log.info("SMTP 예비 발송: %s → %s", subject, recipient)


# ----------------------------------------------------------------------
# 공고 알림
# ----------------------------------------------------------------------

def _repost_note(row: dict) -> str:
    """끌올이면 최초 등록일을 알려준다.

    "두 달째 안 채워지는 자리" 라는 신호라 지원자에게 쓸모가 있다.
    """
    first = row.get("original_posted_at")
    return f"끌올 · 최초 {first}" if first else ""


def _format_posting_text(row: dict) -> str:
    bits = [f"■ {row['title']}"]
    meta = " / ".join(
        str(v) for v in (
            row.get("company_name"),
            row.get("region"),
            row.get("employment_type"),
        ) if v
    )
    if meta:
        bits.append(f"   {meta}")
    if row.get("deadline"):
        bits.append(f"   마감 {row['deadline']}")
    note = _repost_note(row)
    if note:
        bits.append(f"   {note}")
    # 담당자 연락처는 싣지 않는다. 원문 링크에서 확인하면 된다.
    bits.append(f"   {row['detail_url']}")
    return "\n".join(bits)


def _format_posting_html(row: dict) -> str:
    import html as h

    meta = " · ".join(
        h.escape(str(v)) for v in (
            row.get("company_name"),
            row.get("region"),
            row.get("employment_type"),
        ) if v
    )
    deadline = f"<div style='color:#888'>마감 {h.escape(str(row['deadline']))}</div>" if row.get("deadline") else ""
    note = _repost_note(row)
    repost = (
        f"<div style='display:inline-block;margin-top:5px;padding:1px 6px;border-radius:2px;"
        f"background:#FBF0E4;color:#8A5A19;font-size:11px'>{h.escape(note)}</div>"
    ) if note else ""
    return (
        "<div style='margin:0 0 22px;padding:0 0 18px;border-bottom:1px solid #eee'>"
        f"<div style='font-size:15px;font-weight:600;margin-bottom:6px'>"
        f"<a href='{h.escape(row['detail_url'])}' style='color:#111;text-decoration:none'>"
        f"{h.escape(row['title'])}</a></div>"
        f"<div style='color:#666;font-size:13px'>{meta}</div>"
        f"{deadline}{repost}"
        f"<div style='margin-top:8px'><a href='{h.escape(row['detail_url'])}' "
        "style='color:#2563eb;font-size:13px;text-decoration:none'>공고 보기 →</a></div>"
        "</div>"
    )


def send_new_postings(rows: list[dict], to: str | None = None) -> None:
    """신규 공고 알림 메일."""
    if not rows:
        return

    count = len(rows)
    subject = f"[CPAPING] 신규 수습회계사 공고 {count}건"
    if count == 1:
        subject = f"[CPAPING] {rows[0].get('company_name') or '신규'} — {rows[0]['title'][:40]}"

    text = "\n\n".join(_format_posting_text(r) for r in rows)
    text = f"새로 올라온 공고 {count}건입니다.\n\n{text}\n\n— CPAPING"

    html = (
        "<div style='font-family:-apple-system,BlinkMacSystemFont,\"Apple SD Gothic Neo\",sans-serif;"
        "max-width:600px;margin:0 auto;padding:24px'>"
        f"<div style='font-size:13px;color:#666;margin-bottom:20px'>새로 올라온 공고 {count}건</div>"
        + "".join(_format_posting_html(r) for r in rows)
        + "<div style='color:#aaa;font-size:12px;margin-top:8px'>CPAPING</div></div>"
    )
    send_mail(subject, text, html, to=to)


def send_alert(subject: str, message: str, to: str | None = None) -> None:
    """크롤러 장애 알림 (관리자용).

    Resend 가 죽어서 실패했을 수도 있으므로 SMTP 로 한 번 더 시도한다.
    장애를 알리는 경로가 장애와 함께 죽으면 안 된다.
    """
    title = f"[CPAPING 경고] {subject}"
    try:
        send_mail(title, message, to=to)
    except Exception as exc:
        log.warning("Resend 로 경고를 못 보냈습니다 (%s). SMTP 로 재시도합니다.", exc)
        send_mail_smtp(title, message, to=to)


# ----------------------------------------------------------------------
# 구독자 발송
# ----------------------------------------------------------------------

SITE = "https://cpaping.com"


def send_confirmation(email: str, confirm_token: str, unsubscribe_token: str = "") -> None:
    """더블 옵트인 확인 메일.

    보통은 Pages Function 이 신청 즉시 보낸다. 발송에 실패했거나 Resend 키가
    없을 때 크롤러가 대신 보낸다.
    """
    url = f"{SITE}/api/confirm?token={confirm_token}"
    unsubscribe = f"{SITE}/api/unsubscribe?token={unsubscribe_token}" if unsubscribe_token else ""
    text = (
        "CPAPING 구독을 신청하셨습니다.\n\n"
        f"아래 링크를 눌러 구독을 확정해 주세요.\n{url}\n\n"
        "본인이 신청한 것이 아니라면 이 메일을 무시하세요. "
        "링크를 누르지 않으면 아무 메일도 보내지 않습니다.\n"
        "신청 후 7일 안에 확인하지 않으면 입력하신 주소는 자동으로 삭제됩니다.\n\n"
        + (f"바로 구독을 취소하려면: {unsubscribe}\n" if unsubscribe else "")
        + f"개인정보처리방침: {SITE}/privacy\n\n— CPAPING"
    )
    html = (
        "<div style='font-family:-apple-system,BlinkMacSystemFont,\"Apple SD Gothic Neo\",sans-serif;"
        "max-width:600px;margin:0 auto;padding:28px;color:#101317'>"
        "<div style='font-size:15px;font-weight:600;margin-bottom:14px'>구독을 확정해 주세요</div>"
        "<p style='font-size:13.5px;color:#5B6472;line-height:1.7;margin:0 0 22px'>"
        "아래 버튼을 누르면 회계법인 수습 공고가 올라올 때마다 알려드립니다.</p>"
        f"<a href='{url}' style='display:inline-block;padding:11px 20px;background:#123A8A;"
        "color:#fff;text-decoration:none;border-radius:4px;font-size:13.5px;font-weight:500'>"
        "구독 확정하기</a>"
        "<p style='font-size:11.5px;color:#868D99;line-height:1.7;margin:26px 0 0'>"
        "본인이 신청한 것이 아니라면 이 메일을 무시하세요. "
        "링크를 누르지 않으면 아무 메일도 보내지 않습니다. "
        "신청 후 7일 안에 확인하지 않으면 입력하신 주소는 자동으로 삭제됩니다.</p>"
        f"<p style='font-size:11.5px;color:#B0B5BD;margin:18px 0 0'>CPAPING · "
        + (f"<a href='{unsubscribe}' style='color:#868D99'>구독 취소</a> · " if unsubscribe else "")
        + f"<a href='{SITE}/privacy' style='color:#868D99'>개인정보처리방침</a></p></div>"
    )
    # 확인 메일에도 해지 수단을 둔다. 확정만 하고 알림을 아직 못 받은 사람은
    # 이 메일 말고는 해지할 방법이 없다.
    headers = {
        "List-Unsubscribe": f"<{unsubscribe}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    } if unsubscribe else None
    send_mail("[CPAPING] 구독 확정 메일입니다", text, html, to=email,
              extra_headers=headers)


def send_to_subscriber(subscriber: dict, rows: list[dict]) -> None:
    """구독자 한 명에게 신규 공고 알림. 하단에 원클릭 해지 링크를 넣는다."""
    if not rows:
        return

    unsubscribe = f"{SITE}/api/unsubscribe?token={subscriber['unsubscribe_token']}"
    count = len(rows)

    subject = f"[CPAPING] 신규 수습회계사 공고 {count}건"
    if count == 1:
        subject = f"[CPAPING] {rows[0].get('company_name') or '신규'} — {rows[0]['title'][:40]}"

    text = "\n\n".join(_format_posting_text(r) for r in rows)
    text = (
        f"새로 올라온 공고 {count}건입니다.\n\n{text}\n\n"
        f"— CPAPING\n"
        f"의견이나 요청은 이 메일에 그대로 답장해 주세요.\n"
        f"수신 거부: {unsubscribe}"
    )

    html = (
        "<div style='font-family:-apple-system,BlinkMacSystemFont,\"Apple SD Gothic Neo\",sans-serif;"
        "max-width:600px;margin:0 auto;padding:24px'>"
        f"<div style='font-size:13px;color:#666;margin-bottom:20px'>새로 올라온 공고 {count}건</div>"
        + "".join(_format_posting_html(r) for r in rows)
        + "<div style='color:#868D99;font-size:12px;margin-top:14px;line-height:1.7'>"
        "의견이나 요청은 이 메일에 그대로 답장해 주세요.<br>"
        "CPAPING · "
        f"<a href='{unsubscribe}' style='color:#868D99'>수신 거부</a> · "
        f"<a href='{SITE}/privacy' style='color:#868D99'>개인정보처리방침</a></div></div>"
    )

    # List-Unsubscribe 헤더가 있으면 메일 클라이언트가 자체 해지 버튼을 띄운다.
    send_mail(subject, text, html, to=subscriber["email"],
              extra_headers={"List-Unsubscribe": f"<{unsubscribe}>",
                             "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"})
