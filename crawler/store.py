"""Supabase 저장. PostgREST 를 requests 로 직접 호출한다.

supabase-py 를 쓰지 않는 이유는 의존성을 줄이기 위해서다. 필요한 동작이
select / upsert / update 세 가지뿐이라 REST 로 충분하다.
"""

from __future__ import annotations

import hashlib
import logging
import os
from datetime import date, datetime, timedelta, timezone

import requests

log = logging.getLogger(__name__)

TIMEOUT_SEC = 30

# 공고 내용이 바뀌었는지 볼 때 기준이 되는 필드
_HASH_FIELDS = (
    "title", "company_name", "region", "work_region", "employment_type",
    "hiring_status", "headcount", "career", "salary", "education",
    "deadline", "body",
)


class SupabaseError(RuntimeError):
    pass


class Store:
    def __init__(self, url: str | None = None, key: str | None = None):
        self.url = (url or os.environ.get("SUPABASE_URL", "")).rstrip("/")
        self.key = key or os.environ.get("SUPABASE_SECRET_KEY", "")
        if not self.url or not self.key:
            raise SupabaseError(
                "SUPABASE_URL / SUPABASE_SECRET_KEY 가 없습니다. .env 를 확인하세요."
            )
        self.session = requests.Session()
        self.session.headers.update({
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        })

    # ------------------------------------------------------------------
    def _request(self, method: str, table: str, **kwargs) -> list[dict]:
        res = self.session.request(
            method, f"{self.url}/rest/v1/{table}", timeout=TIMEOUT_SEC, **kwargs
        )
        if not res.ok:
            raise SupabaseError(f"{method} {table} 실패 ({res.status_code}): {res.text[:400]}")
        if not res.content or res.status_code == 204:
            return []
        return res.json()

    # ------------------------------------------------------------------
    def existing_ij_ids(self, source: str) -> set[str]:
        """이미 저장된 공고의 ij_id 집합."""
        rows = self._request(
            "GET", "job_postings",
            params={"select": "ij_id", "source": f"eq.{source}"},
        )
        return {r["ij_id"] for r in rows}

    def company_history(self, source: str, company_name: str) -> list[dict]:
        """같은 법인의 과거 공고. 끌올 판정에 쓴다.

        게시판에서 내려간 공고도 우리는 지우지 않고 보존하므로, 한공회가
        1개월 뒤 지워버린 글도 여기서 찾을 수 있다.
        """
        if not company_name:
            return []
        return self._request(
            "GET", "job_postings",
            params={
                "select": "id,ij_id,company_name,title,posted_at,original_id,original_posted_at,repost_count",
                "source": f"eq.{source}",
                "company_name": f"eq.{company_name}",
                "order": "posted_at.asc",
            },
        )

    def upsert_postings(self, rows: list[dict]) -> list[dict]:
        """(source, ij_id) 기준으로 있으면 갱신, 없으면 삽입."""
        if not rows:
            return []
        return self._request(
            "POST", "job_postings",
            params={"on_conflict": "source,ij_id"},
            headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            json=rows,
        )

    def mark_removed(self, source: str, alive_ij_ids: list[str]) -> int:
        """게시판에서 사라진 공고에 removed_at 을 남긴다.

        한공회는 1개월이 지난 글을 자동 삭제한다. 우리 DB 에서는 지우지 않고
        사라진 시점만 기록해 이력을 보존한다.
        """
        params = {
            "source": f"eq.{source}",
            "removed_at": "is.null",
            "select": "ij_id",
        }
        if alive_ij_ids:
            quoted = ",".join(f'"{i}"' for i in alive_ij_ids)
            params["ij_id"] = f"not.in.({quoted})"
        rows = self._request(
            "PATCH", "job_postings",
            params=params,
            headers={"Prefer": "return=representation"},
            json={"removed_at": _now_iso()},
        )
        return len(rows)

    def expire_past_deadline(self, source: str) -> int:
        """마감일이 지난 공고를 만료 처리한다.

        기존 공고는 상세를 다시 조회하지 않으므로(상대 서버 부담) 마감 판정을
        DB 에 저장된 마감일로 따로 갱신한다.
        """
        rows = self._request(
            "PATCH", "job_postings",
            params={
                "source": f"eq.{source}",
                "deadline": f"lt.{date.today().isoformat()}",
                "is_expired": "is.false",
                "select": "id",
            },
            headers={"Prefer": "return=representation"},
            json={"is_expired": True, "is_target": False},
        )
        return len(rows)

    def unnotified_targets(self, source: str) -> list[dict]:
        """아직 알리지 않은 알림 대상 공고."""
        return self._request(
            "GET", "job_postings",
            params={
                "select": "*",
                "source": f"eq.{source}",
                "is_target": "is.true",
                "is_expired": "is.false",
                "notified_at": "is.null",
                "order": "posted_at.desc",
            },
        )

    def mark_notified(self, ids: list[int]) -> None:
        if not ids:
            return
        self._request(
            "PATCH", "job_postings",
            params={"id": f"in.({','.join(str(i) for i in ids)})"},
            headers={"Prefer": "return=minimal"},
            json={"notified_at": _now_iso()},
        )

    # ------------------------------------------------------------------
    # 구독자
    # ------------------------------------------------------------------
    def pending_confirmations(self, limit: int = 50) -> list[dict]:
        """확인 메일을 아직 못 보낸 신청 건.

        보통은 Pages Function 이 신청 즉시 보낸다. Resend 키가 없거나
        발송이 실패한 건을 여기서 주워 담는다.
        """
        return self._request(
            "GET", "subscribers",
            params={
                "select": "id,email,confirm_token,unsubscribe_token",
                "status": "eq.pending",
                "confirmation_sent_at": "is.null",
                "order": "created_at.asc",
                "limit": str(limit),
            },
        )

    def mark_confirmation_sent(self, subscriber_id: int) -> None:
        self._request(
            "PATCH", "subscribers",
            params={"id": f"eq.{subscriber_id}"},
            headers={"Prefer": "return=minimal"},
            json={"confirmation_sent_at": _now_iso()},
        )

    def purge_stale_pending(self, days: int = 7) -> int:
        """확인하지 않은 구독 신청을 지운다.

        개인정보처리방침 제3조가 정한 보유기간이다. 링크를 누르지 않은
        신청은 동의가 완성되지 않은 것이므로 오래 들고 있을 이유가 없다.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        rows = self._request(
            "DELETE", "subscribers",
            params={"status": "eq.pending", "created_at": f"lt.{cutoff}"},
            headers={"Prefer": "return=representation"},
        )
        return len(rows or [])

    def purge_unsubscribed(self) -> int:
        """해지 표시만 남은 행을 지운다.

        해지는 Pages Function 이 행을 바로 지우므로 보통은 0건이다.
        그 이전에 쌓였거나 발송이 중간에 끊긴 경우를 위한 보정이다.
        """
        rows = self._request(
            "DELETE", "subscribers",
            params={"status": "eq.unsubscribed"},
            headers={"Prefer": "return=representation"},
        )
        return len(rows or [])

    def active_subscribers(self) -> list[dict]:
        return self._request(
            "GET", "subscribers",
            params={
                "select": "id,email,unsubscribe_token,employment_filter,confirmed_at",
                "status": "eq.active",
            },
        )

    def postings_for_subscriber(self, source: str, subscriber: dict) -> list[dict]:
        """이 구독자에게 아직 보내지 않은, 구독 이후에 올라온 공고.

        구독 시점 이전 공고는 보내지 않는다. 갓 구독한 사람에게 기존 공고를
        한꺼번에 보내면 스팸으로 보인다. 그건 사이트에서 보면 된다.
        """
        params = {
            "select": "id,title,company_name,region,employment_type,deadline,detail_url,original_posted_at",
            "source": f"eq.{source}",
            "is_target": "is.true",
            "is_expired": "is.false",
            "order": "deadline.asc",
        }
        if subscriber.get("confirmed_at"):
            params["first_seen_at"] = f"gt.{subscriber['confirmed_at']}"

        employment = {"full": "neq.Part Time", "part": "eq.Part Time"}
        if subscriber.get("employment_filter") in employment:
            params["employment_type"] = employment[subscriber["employment_filter"]]

        candidates = self._request("GET", "job_postings", params=params)
        if not candidates:
            return []

        sent = self._request(
            "GET", "notification_logs",
            params={
                "select": "posting_id",
                "subscriber_id": f"eq.{subscriber['id']}",
                "posting_id": f"in.({','.join(str(c['id']) for c in candidates)})",
            },
        )
        already = {row["posting_id"] for row in sent}
        return [c for c in candidates if c["id"] not in already]

    def log_notifications(self, subscriber_id: int, posting_ids: list[int]) -> None:
        if not posting_ids:
            return
        self._request(
            "POST", "notification_logs",
            params={"on_conflict": "subscriber_id,posting_id"},
            headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
            json=[{"subscriber_id": subscriber_id, "posting_id": pid} for pid in posting_ids],
        )

    def mails_sent_today(self) -> int:
        """오늘 Resend 로 나간 통수. 무료 캡이 UTC 일 단위로 리셋되므로 UTC 자정 기준.

        구독자 알림과 확인 메일이 같은 한도를 쓰므로 둘 다 센다. 하루 100통
        규모라 행을 다 받아 세도 부담이 없다. PostgREST 의 count=exact 를 쓰려면
        _request 가 응답 헤더를 돌려주게 고쳐야 하는데 그만한 값이 없다.
        """
        since = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0).isoformat()
        notifications = self._request(
            "GET", "notification_logs",
            params={"select": "id", "sent_at": f"gte.{since}"},
        )
        confirmations = self._request(
            "GET", "subscribers",
            params={"select": "id", "confirmation_sent_at": f"gte.{since}"},
        )
        return len(notifications) + len(confirmations)

    # ------------------------------------------------------------------
    def start_run(self, board: str) -> int | None:
        rows = self._request(
            "POST", "crawl_runs",
            headers={"Prefer": "return=representation"},
            json={"board": board},
        )
        return rows[0]["id"] if rows else None

    def finish_run(self, run_id: int | None, **fields) -> None:
        if run_id is None:
            return
        self._request(
            "PATCH", "crawl_runs",
            params={"id": f"eq.{run_id}"},
            headers={"Prefer": "return=minimal"},
            json={"finished_at": _now_iso(), **fields},
        )

    def hours_since_last_new_posting(self, source: str) -> float | None:
        """마지막으로 신규 공고를 본 뒤 흐른 시간(시간 단위).

        사이트 구조가 바뀌어 파서가 조용히 빈 결과를 내는 상황을 감지한다.
        """
        rows = self._request(
            "GET", "job_postings",
            params={
                "select": "first_seen_at",
                "source": f"eq.{source}",
                "order": "first_seen_at.desc",
                "limit": "1",
            },
        )
        if not rows:
            return None
        seen = datetime.fromisoformat(rows[0]["first_seen_at"].replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - seen).total_seconds() / 3600


# ----------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso(value) -> str | None:
    return value.isoformat() if isinstance(value, date) else value


def content_hash(posting) -> str:
    """공고 내용이 바뀌었는지 비교하기 위한 해시."""
    parts = [str(getattr(posting, f, "") or "") for f in _HASH_FIELDS]
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def to_light_row(posting) -> dict:
    """이미 아는 공고용. 목록에서만 확인되는 값만 갱신한다.

    상세를 조회하지 않았으므로 마감일·본문·분류 결과를 None 으로 덮어쓰면
    안 된다. upsert 배치는 모든 행의 키가 같아야 해서 별도 배치로 보낸다.

    NOT NULL 컬럼은 반드시 넣어야 한다. 포스트그레스는 ON CONFLICT 로 넘어가기
    전에 NOT NULL 을 먼저 검사하기 때문에, 빠지면 갱신이 아니라 오류가 난다.
    """
    return {
        "source": posting.source,
        "ij_id": posting.ij_id,
        "detail_url": posting.detail_url,
        "seq": posting.seq,
        "title": posting.title,
        "hiring_status": posting.hiring_status or None,
        "view_count": posting.view_count,
        "last_seen_at": _now_iso(),
    }


def to_row(posting) -> dict:
    """Posting → job_postings 테이블 행 (상세까지 조회한 신규 공고용)."""
    labels = getattr(posting, "labels", {}) or {}
    return {
        "source": posting.source,
        "ij_id": posting.ij_id,
        "seq": posting.seq,
        "detail_url": posting.detail_url,
        "title": posting.title,
        "company_name": posting.company_name or None,
        "region": posting.region or None,
        "work_region": posting.work_region or None,
        "employment_type": posting.employment_type or None,
        "hiring_status": posting.hiring_status or None,
        "headcount": posting.headcount or None,
        "career": posting.career or None,
        "salary": posting.salary or None,
        "education": posting.education or None,
        "posted_at": _iso(posting.posted_at),
        "deadline": _iso(posting.deadline),
        "view_count": posting.view_count,
        "body": posting.body or None,
        "homepage": posting.homepage or None,
        "is_big4": bool(labels.get("is_big4")),
        "big4_name": labels.get("big4"),
        "posting_type": labels.get("posting_type"),
        "job_category": labels.get("job_category"),
        "job_category_confidence": labels.get("job_category_confidence"),
        "needs_review": bool(labels.get("needs_review")),
        "is_expired": bool(labels.get("is_expired")),
        "is_target": bool(labels.get("is_target")),
        "content_hash": content_hash(posting),
        "last_seen_at": _now_iso(),
        # 끌올 판정 결과. main 에서 채워 넣는다.
        **(getattr(posting, "repost", None) or
           {"original_id": None, "original_posted_at": None, "repost_count": 0}),
    }
