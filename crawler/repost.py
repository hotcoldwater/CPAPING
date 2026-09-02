"""끌올(재등록) 판정.

한공회는 등록 1개월이 지난 글을 자동으로 지운다. 채용이 안 된 법인은 같은
자리를 다시 올린다. 지원자에게는 "새로 열린 자리"와 "두 달째 안 채워지는
자리"가 전혀 다른 정보이므로 구분해서 보여준다.

판정은 보수적으로 한다. 같은 법인이 다른 본부에 새 자리를 열어도 제목이
비슷할 수 있는데("수습회계사 모집" 같은 제목은 너무 일반적이다), 그걸 끌올로
잘못 부르면 사용자가 "이미 본 거네" 하고 넘겨 새 기회를 놓친다.
**애매하면 최초 공고로 본다.**
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

# 제목이 이 정도로 닮아야 같은 자리로 본다.
# 0.85 는 "수습회계사 모집" 과 "수습 회계사 모집" 은 같게 보고,
# "감사본부 수습회계사 모집" 과 "세무본부 수습회계사 모집" 은 다르게 본다.
SIMILARITY_THRESHOLD = 0.85


def normalize_company(name: str) -> str:
    """법인명 정규화. 지점까지 같아야 같은 곳으로 본다.

    '삼원회계법인(성서지점)' 과 '삼원회계법인' 은 다른 곳으로 둔다.
    지점이 다르면 자리도 다르기 때문이다.
    """
    return re.sub(r"\s+", "", name or "")


def normalize_title(title: str, company: str = "") -> str:
    """제목 정규화.

    연도는 남긴다. '2026년 신입' 과 '2027년 신입' 은 다른 채용이다.
    """
    text = title or ""
    # 앞머리의 [법인명] 은 비교에서 제외한다 (붙이는 법인도 있고 아닌 곳도 있다)
    text = re.sub(r"^[\[(【][^\])】]{0,30}[\])】]\s*", "", text.strip())
    # 공백, 문장부호 차이는 무시
    text = re.sub(r"[\s\-—·,.!~()\[\]{}/]+", "", text).lower()

    # 제목 안의 법인명도 뺀다. 같은 자리를 두고도 어떤 글은
    # "[동성회계법인] 수습 회계사 채용", 어떤 글은 "동성회계법인 수습회계사 채용"
    # 으로 올라와 글자 수 차이만으로 유사도가 크게 떨어진다.
    firm = normalize_company(company).lower()
    if len(firm) >= 3:
        stripped = text.replace(firm, "")
        if stripped:  # 제목이 법인명뿐이면 원래 것을 쓴다
            text = stripped
    return text


def title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


# 제목에서 자리를 구분짓는 표지. 글자만 비교하면 놓친다.
# '2026 신입 공채' 와 '2027 신입 공채' 는 한 글자 차이라 유사도가 0.95 나오지만
# 서로 다른 채용이다.
_YEAR = re.compile(r"20\d{2}")
_UNIT = re.compile(r"\d+(?:본부|사업부|사업본부|부문|팀|부)")

# 지점 표기는 제목 앞머리 괄호 안에만 있는 경우가 많다.
# '[PKF서현회계법인] …' 과 '[PKF서현회계법인_광주지점] …' 은 괄호를 떼면
# 나머지가 한 글자도 다르지 않다. 한공회 회사명 칸에도 지점이 안 들어가서
# 이걸 안 보면 서울 본점과 광주지점 공고가 같은 자리가 된다.
_BRANCH = re.compile(r"[가-힣A-Za-z0-9]{1,10}(?:지점|본점|지사|분사무소|사무소)")


def signature(normalized_title: str, raw_title: str = "",
              region: str = "") -> tuple:
    """(연도, 조직단위, 지점, 지역) — 하나라도 다르면 다른 자리로 본다."""
    return (
        frozenset(_YEAR.findall(normalized_title)),
        frozenset(_UNIT.findall(normalized_title)),
        frozenset(_BRANCH.findall(raw_title or "")),
        re.sub(r"\s+", " ", (region or "").strip()),
    )


def find_original(posting, candidates: list[dict]) -> dict | None:
    """같은 자리의 과거 공고를 찾는다. 없으면 None.

    candidates 는 같은 법인의 과거 공고들. 여러 개가 걸리면 가장 오래된
    것을 고른다. 끌올이 반복되면 사슬이 아니라 항상 최초를 가리키게 해서
    '최초 등록일' 이 흐려지지 않게 한다.
    """
    company = normalize_company(posting.company_name)
    title = normalize_title(posting.title, posting.company_name)
    if not title:
        return None
    posted = getattr(posting, "posted_at", None)
    region = getattr(posting, "work_region", None) or getattr(posting, "region", "")
    sig = signature(title, posting.title, region)

    matched = []
    for row in candidates:
        if row.get("ij_id") == posting.ij_id:
            continue  # 자기 자신
        if normalize_company(row.get("company_name", "")) != company:
            continue
        # 끌올은 시간이 지나 다시 올리는 것이다. 같은 날 올라온 둘은 한 법인이
        # 여러 자리를 동시에 연 것이지 다시 올린 게 아니다.
        if posted and str(row.get("posted_at") or "") == str(posted):
            continue
        other = normalize_title(row.get("title", ""), company)
        # 연도·본부·지점·지역이 다르면 글자가 아무리 닮아도 다른 자리다
        if sig != signature(other, row.get("title", ""),
                            row.get("work_region") or row.get("region") or ""):
            continue
        if title_similarity(title, other) < SIMILARITY_THRESHOLD:
            continue
        matched.append(row)

    if not matched:
        return None

    # 이미 최초를 가리키고 있는 후보가 있으면 그 최초를 따라간다
    def sort_key(row):
        return (row.get("original_posted_at") or row.get("posted_at") or "9999-99-99", row.get("id", 0))

    return min(matched, key=sort_key)


def repost_fields(posting, candidates: list[dict]) -> dict:
    """job_postings 에 넣을 끌올 관련 값. 최초 공고면 빈 값."""
    original = find_original(posting, candidates)
    if original is None:
        return {"original_id": None, "original_posted_at": None, "repost_count": 0}

    # 최초 공고가 이미 끌올이면 그것이 가리키는 최초를 그대로 쓴다
    root_id = original.get("original_id") or original.get("id")
    root_posted = original.get("original_posted_at") or original.get("posted_at")

    return {
        "original_id": root_id,
        "original_posted_at": root_posted,
        "repost_count": (original.get("repost_count") or 0) + 1,
    }
