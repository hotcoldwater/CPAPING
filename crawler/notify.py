"""이메일 알림 발송 (Gmail SMTP).

Phase 1 에서는 관리자(CPAPING_MAIL_TO) 한 명에게만 보낸다.
구독자별 발송은 Phase 3 에서 이 모듈을 재사용한다.
"""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

log = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
SENDER_NAME = "CPAPING"

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
              to: str | None = None) -> None:
    """메일 1통 발송. 실패하면 예외를 그대로 올린다."""
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
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=_ssl_context(), timeout=30) as smtp:
        smtp.login(user, password)
        smtp.send_message(msg)

    log.info("메일 발송: %s → %s", subject, recipient)


# ----------------------------------------------------------------------
# 공고 알림
# ----------------------------------------------------------------------

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
    return (
        "<div style='margin:0 0 22px;padding:0 0 18px;border-bottom:1px solid #eee'>"
        f"<div style='font-size:15px;font-weight:600;margin-bottom:6px'>"
        f"<a href='{h.escape(row['detail_url'])}' style='color:#111;text-decoration:none'>"
        f"{h.escape(row['title'])}</a></div>"
        f"<div style='color:#666;font-size:13px'>{meta}</div>"
        f"{deadline}"
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
    """크롤러 장애 알림 (관리자용)."""
    send_mail(f"[CPAPING 경고] {subject}", message, to=to)
