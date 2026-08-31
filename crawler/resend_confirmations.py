"""확인 메일을 아직 안 누른 사람에게 다시 보낸다.

    python crawler/resend_confirmations.py --dry-run   대상만 확인
    python crawler/resend_confirmations.py             실제 발송

본인이 신청한 확인 메일이므로 재발송은 정당하다. 다만 자동으로 반복하지는
않는다. 스팸함에 들어간 메일을 같은 경로로 계속 보내봐야 소용이 없고,
받는 사람에게는 성가심이 되기 때문이다. 필요할 때 손으로 실행한다.

메일이 스팸으로 분류되는 원인을 먼저 없앤 뒤에 쓰는 것이 순서다.
"""

from __future__ import annotations

import argparse
import logging
import sys

from dotenv import load_dotenv

import notify
import store

log = logging.getLogger("resend")


def main() -> int:
    parser = argparse.ArgumentParser(description="확인 메일 재발송")
    parser.add_argument("--dry-run", action="store_true", help="발송 없이 대상만 표시")
    args = parser.parse_args()

    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    db = store.Store()
    # 이미 보낸 건도 포함해야 한다. pending_confirmations 는 미발송만 가져온다.
    targets = db._request(
        "GET", "subscribers",
        params={"select": "id,email,confirm_token,unsubscribe_token,created_at",
                "status": "eq.pending", "order": "created_at.asc"},
    )

    if not targets:
        print("확인 대기자가 없습니다.")
        return 0

    print(f"확인 대기 {len(targets)}명")
    for row in targets:
        email = row["email"]
        masked = email[:3] + "***@" + email.split("@")[1]
        if args.dry_run:
            print(f"  {masked}  (신청 {row['created_at'][:16]})")
            continue
        try:
            notify.send_confirmation(email, row["confirm_token"],
                                     row.get("unsubscribe_token", ""))
            print(f"  ✅ {masked}")
        except Exception as exc:
            print(f"  ❌ {masked} — {exc}")

    if args.dry_run:
        print("\n--dry-run 이라 발송하지 않았습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
