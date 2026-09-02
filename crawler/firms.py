"""공고에서 회계법인을 추려내 firms 테이블을 채운다.

지점은 법인 하나로 묶는다. 지원자는 "삼원회계법인이 어떤 곳인가" 가 궁금하지
성서지점만 따로 보고 싶지는 않다. 원래 표기는 aliases 에 남겨 공고를 연결한다.

**크롤러는 자기 컬럼만 건드린다.** 재무·인력 자료는 사람이 사업보고서를 보고
채우는데, 10분마다 도는 크롤이 그걸 덮어쓰면 안 된다.
"""

from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)

# 크롤러가 소유한 컬럼. 이 외에는 절대 쓰지 않는다.
CRAWLER_COLUMNS = (
    "name", "aliases", "slug", "region", "homepage",
    "first_posted_at", "last_posted_at", "posting_count", "repost_count",
    "crawler_updated_at",
)

# 한공회 공고의 표기 흔들림을 바로잡는다
NAME_FIXES = {
    "대현회게법인": "대현회계법인",   # 원문 오타
    "안진회게법인": "안진회계법인",
}


def canonical_name(raw: str) -> str:
    """지점을 떼고 법인 단위 이름으로 만든다.

    '선진회계법인 대구지점'   → '선진회계법인'
    '삼원회계법인(성서지점)'  → '삼원회계법인'
    '[대주회계법인 5사업부]'  → '대주회계법인'
    '회계법인 베율'          → '베율회계법인'

    이름을 다는 방식이 두 가지다. 접두사형으로 공고를 올리는 곳이 있어
    그대로 두면 사업보고서에서 받은 '베율회계법인' 과 다른 법인이 되어
    행이 둘로 갈린다. 한쪽에는 공고만, 다른 쪽에는 재무만 남는다.
    """
    name = re.sub(r"\s*\([^)]*\)", "", raw or "").strip()
    # 'OO지점' 을 통째로 떼야 '대구' 가 남지 않는다
    name = re.sub(r"\s*[가-힣A-Za-z0-9]*(지점|본점|사업부|사업본부|본부)\s*$", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    m = re.match(r"^\(?(?:유|주|합|유한)?\)?\s*회계법인\s*(.+)$", name)
    if m:
        name = f"{m.group(1).strip()}회계법인"
    return NAME_FIXES.get(name, name)


def clean_region(raw: str) -> str | None:
    """'지역무관 지역무관' → '지역무관'.

    상세 페이지가 시도와 세부지역을 이어 붙이는데, 시도가 '지역무관' 이면
    세부지역도 같은 값이 들어와 두 번 찍힌다.
    """
    parts = [p for p in re.split(r"\s+", (raw or "").strip()) if p]
    seen, out = set(), []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return " ".join(out) or None


def slugify(name: str) -> str:
    """URL 에 쓸 값. 한글을 그대로 남긴다 — 검색어와 일치해야 유리하다."""
    return re.sub(r"[^가-힣A-Za-z0-9]+", "-", name).strip("-")


def build(postings: list[dict]) -> list[dict]:
    """공고 목록에서 법인 행을 만든다.

    postings 는 job_postings 에서 읽은 dict 리스트.
    """
    from collections import defaultdict
    from datetime import datetime, timezone

    grouped: dict[str, list[dict]] = defaultdict(list)
    for p in postings:
        # 빅4 는 알림에서 빼기로 했으므로 법인 페이지도 만들지 않는다.
        # 이 걸러내기가 없으면 알림에는 안 나오는 EY한영·PwC 의
        # 빈 소개 페이지가 sitemap 에까지 올라간다.
        if p.get("is_big4"):
            continue
        name = canonical_name(p.get("company_name", ""))
        if name:
            grouped[name].append(p)

    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for name, items in grouped.items():
        posted = sorted(p["posted_at"] for p in items if p.get("posted_at"))
        aliases = sorted({p["company_name"] for p in items if p["company_name"] != name})
        # 가장 최근 공고의 값을 쓴다. 법인이 이사하거나 홈페이지를 바꿀 수 있다.
        latest = max(items, key=lambda p: p.get("posted_at") or "")

        rows.append({
            "name": name,
            "aliases": aliases,
            "slug": slugify(name),
            "region": clean_region(latest.get("work_region") or latest.get("region")),
            "homepage": next((p["homepage"] for p in items if p.get("homepage")), None),
            "first_posted_at": posted[0] if posted else None,
            "last_posted_at": posted[-1] if posted else None,
            "posting_count": len(items),
            "repost_count": sum(1 for p in items if p.get("original_id")),
            "crawler_updated_at": now,
        })
    return rows


def sync(db, source: str) -> int:
    """공고에서 법인을 뽑아 저장한다. 사람이 채운 컬럼은 손대지 않는다."""
    postings = db._request(
        "GET", "job_postings",
        params={
            "select": "company_name,region,work_region,homepage,posted_at,original_id,is_big4",
            "source": f"eq.{source}",
        },
    )
    rows = build(postings)
    if not rows:
        return 0

    # on_conflict 로 이름이 같으면 갱신한다. payload 에 없는 컬럼(재무 등)은
    # PostgREST 가 건드리지 않으므로 사람이 채운 값이 그대로 남는다.
    db._request(
        "POST", "firms",
        params={"on_conflict": "name"},
        headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        json=rows,
    )
    log.info("법인 %d곳 갱신", len(rows))
    return len(rows)
