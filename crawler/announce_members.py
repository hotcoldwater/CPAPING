"""기존 구독자에게 회원가입·댓글 기능을 안내하는 일회성 메일.

    python crawler/announce_members.py            받을 사람 수와 본문만 출력 (보내지 않음)
    python crawler/announce_members.py --send     실제 발송

2026-09-09 운영자 결정: 메일만 구독하는 기능을 없애고 알림은 회원가입으로 받는다.
기존 구독자는 그대로 알림을 받지만, 가입하면 알림 조건을 계정에서 관리하고 댓글을
쓸 수 있다는 것을 한 번 알린다. 한 번만 보낸다 — 두 번 보내면 광고다.

발송은 notify.send_mail(Resend) 을 그대로 쓴다. 수신 거부 링크를 반드시 넣는다.
"""

from __future__ import annotations

import argparse
import sys

from dotenv import load_dotenv

import notify
import store

SITE = "https://cpaping.com"

SUBJECT = "CPAPING 에 회원가입과 댓글 기능이 생겼습니다"


def body_text(unsubscribe: str, settings: str) -> str:
    return (
        "안녕하세요, CPAPING 입니다.\n\n"
        "지금까지는 이메일만 등록해 새 공고 알림을 받으셨습니다. 이제 회원가입이 생겼고, 가입하면\n"
        "  · 공고와 회계법인 페이지마다 댓글을 남기고 다른 지원자·법인의 이야기를 볼 수 있습니다\n"
        "  · 알림 조건(지역·고용형태)을 내 계정에서 바로 바꿀 수 있습니다\n\n"
        f"가입은 여기서: {SITE}/login/\n"
        "지금 알림을 받는 이메일로 가입하시면 기존 알림이 그대로 계정에 연결됩니다.\n\n"
        "가입하지 않아도 지금처럼 새 공고 알림은 계속 받으실 수 있습니다.\n"
        "이 안내는 한 번만 보내드립니다.\n\n"
        "— CPAPING\n"
        f"알림 조건 바꾸기: {settings}\n"
        f"수신 거부: {unsubscribe}\n"
        f"개인정보처리방침: {SITE}/privacy"
    )


def body_html(unsubscribe: str, settings: str) -> str:
    return (
        "<div style='font-family:-apple-system,BlinkMacSystemFont,\"Apple SD Gothic Neo\",sans-serif;"
        "max-width:600px;margin:0 auto;padding:24px;color:#101317'>"
        "<div style='font-size:15px;font-weight:600;margin-bottom:12px'>회원가입과 댓글 기능이 생겼습니다</div>"
        "<p style='font-size:13.5px;color:#5B6472;line-height:1.7;margin:0 0 14px'>지금까지는 이메일만 등록해 새 공고 알림을 "
        "받으셨습니다. 이제 회원가입이 생겼고, 가입하면</p>"
        "<ul style='font-size:13.5px;color:#101317;line-height:1.8;margin:0 0 16px;padding-left:18px'>"
        "<li>공고마다 <b>댓글</b>을 남기고 다른 지원자·법인의 이야기를 볼 수 있습니다</li>"
        "<li>알림 조건(지역·고용형태)을 <b>내 계정</b>에서 바로 바꿀 수 있습니다</li></ul>"
        f"<a href='{SITE}/login/' style='display:inline-block;padding:10px 18px;background:#123A8A;color:#fff;"
        "text-decoration:none;border-radius:4px;font-size:13.5px;font-weight:500'>가입하기</a>"
        "<p style='font-size:12.5px;color:#5B6472;line-height:1.7;margin:16px 0 0'>지금 알림을 받는 이메일로 가입하시면 "
        "기존 알림이 그대로 계정에 연결됩니다. 가입하지 않아도 지금처럼 새 공고 알림은 계속 받으실 수 있습니다. "
        "이 안내는 한 번만 보내드립니다.</p>"
        "<p style='font-size:11.5px;color:#868D99;margin:22px 0 0;line-height:1.7'>CPAPING · "
        f"<a href='{settings}' style='color:#868D99'>알림 조건</a> · "
        f"<a href='{unsubscribe}' style='color:#868D99'>수신 거부</a> · "
        f"<a href='{SITE}/privacy' style='color:#868D99'>개인정보처리방침</a></p></div>"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--send", action="store_true", help="실제로 보낸다")
    args = parser.parse_args()
    load_dotenv()

    db = store.Store()
    subscribers = db.active_subscribers()
    # 이미 계정에 연결된 구독자에게는 보낼 이유가 없다 (컬럼이 없으면 전부 대상)
    targets = [s for s in subscribers if not s.get("user_id")]
    print(f"active 구독자 {len(subscribers)}명 중 발송 대상 {len(targets)}명")

    sample = targets[0] if targets else {"unsubscribe_token": "TOKEN"}
    unsubscribe = f"{SITE}/api/unsubscribe?token={sample['unsubscribe_token']}"
    settings = f"{SITE}/api/settings?token={sample['unsubscribe_token']}"
    print("\n--- 제목 ---\n" + SUBJECT + "\n\n--- 본문(텍스트, 예시 링크) ---\n" + body_text(unsubscribe, settings))

    if not args.send:
        print("\n(--send 를 붙이면 실제로 보냅니다)")
        return 0

    sent = 0
    for s in targets:
        unsubscribe = f"{SITE}/api/unsubscribe?token={s['unsubscribe_token']}"
        settings = f"{SITE}/api/settings?token={s['unsubscribe_token']}"
        try:
            notify.send_mail(SUBJECT, body_text(unsubscribe, settings), body_html(unsubscribe, settings),
                             to=s["email"],
                             extra_headers={"List-Unsubscribe": f"<{unsubscribe}>",
                                            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"})
            sent += 1
        except Exception as exc:  # 한 명 실패해도 나머지는 보낸다
            print(f"  실패 {s['email']}: {exc}", file=sys.stderr)
    print(f"\n발송 {sent}/{len(targets)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
