"""구독자 현황 조회.

    python crawler/subscribers.py          현황 요약 (이메일은 가림)
    python crawler/subscribers.py --full   이메일 전체 표시

Supabase 대시보드의 Table Editor 에서도 같은 것을 볼 수 있다. 이 스크립트는
터미널에서 숫자만 빠르게 확인하려고 두는 것이다.

기본적으로 이메일을 가리는 이유는, 대부분의 경우 "몇 명인지" 만 알면 되기
때문이다. 개인정보처리방침 제10조가 말하는 "개인정보에 접근할 수 있는
프로그램과 기능의 최소화" 와도 같은 방향이다.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv


def mask(email: str) -> str:
    """abc***@gmail.com — 누구인지 구분은 되되 그대로 노출하지는 않는다."""
    if "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    head = local[:3] if len(local) > 3 else local[:1]
    return f"{head}***@{domain}"


def ago(iso: str) -> str:
    """상대 시각. '3일 전' 이 '2026-08-28T…' 보다 읽기 쉽다."""
    if not iso:
        return "-"
    then = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    seconds = (datetime.now(timezone.utc) - then).total_seconds()
    if seconds < 3600:
        return f"{int(seconds // 60)}분 전"
    if seconds < 86400:
        return f"{int(seconds // 3600)}시간 전"
    return f"{int(seconds // 86400)}일 전"


def main() -> int:
    parser = argparse.ArgumentParser(description="구독자 현황")
    parser.add_argument("--full", action="store_true", help="이메일을 가리지 않고 표시")
    args = parser.parse_args()

    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not (url and key):
        print("SUPABASE_URL / SUPABASE_SECRET_KEY 가 없습니다. .env 를 확인하세요.",
              file=sys.stderr)
        return 1

    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    rows = requests.get(
        f"{url.rstrip('/')}/rest/v1/subscribers",
        params={"select": "email,status,employment_filter,created_at,confirmed_at",
                "order": "created_at.desc"},
        headers=headers, timeout=30,
    ).json()

    if not isinstance(rows, list):
        print(f"조회 실패: {rows}", file=sys.stderr)
        return 1

    status = Counter(r["status"] for r in rows)
    active = status.get("active", 0)
    pending = status.get("pending", 0)

    print()
    print(f"  구독 중  {active}명" + (f"   (확인 대기 {pending}명)" if pending else ""))

    if active:
        filters = Counter(r["employment_filter"] for r in rows if r["status"] == "active")
        label = {"all": "전체", "full": "정규직만", "part": "파트타임만"}
        detail = " · ".join(f"{label.get(k, k)} {v}" for k, v in filters.most_common())
        print(f"  받는 조건  {detail}")

    if not rows:
        print("\n  아직 구독자가 없습니다.\n")
        return 0

    print()
    print(f"  {'이메일':<32} {'상태':<6} {'신청':<10} {'확정'}")
    print("  " + "─" * 62)
    for r in rows:
        email = r["email"] if args.full else mask(r["email"])
        state = {"active": "구독 중", "pending": "대기", "unsubscribed": "해지"}.get(
            r["status"], r["status"])
        print(f"  {email:<32} {state:<6} {ago(r['created_at']):<10} "
              f"{ago(r['confirmed_at']) if r['confirmed_at'] else '-'}")

    if not args.full:
        print("\n  이메일 전체를 보려면: python crawler/subscribers.py --full")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
