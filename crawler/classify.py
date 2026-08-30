"""공고 분류: 빅4 판정 / 채용 유형 판정 / 직무 태깅.

MVP 대상은 "빅4가 아닌 로컬 회계법인의 신입 채용" 이다.
실제 한공회 데이터를 보면 공고는 크게 네 갈래로 나뉜다.

  entry        신입·수습 채용            ← 알림 대상
  experienced  경력직 채용
  partner      개업/반개업/파트너 초빙   ← 이미 개업한 회계사 대상
  ambiguous    판단 불가                 ← 알림 대상 + 검수 큐

놓치는 것보다 한 번 더 보내는 편이 낫다고 보고, ambiguous 는 알림을 보내되
needs_review 로 표시해 사람이 확인할 수 있게 한다.
"""

from __future__ import annotations

import re
from datetime import date

# --------------------------------------------------------------------------
# 빅4
# --------------------------------------------------------------------------

# 회사명/제목에서 찾을 빅4 패턴. 삼O회계법인(삼도·삼율·삼원·삼화·삼지…)이
# 많아 부분 문자열이 아니라 아래 패턴으로만 판정한다.
# 영문 약칭은 \b 를 쓰면 안 된다. 파이썬 정규식에서 한글도 단어 문자라
# 'PwC컨설팅' 의 C 와 컨 사이에는 경계가 생기지 않는다. 영문자만 배제한다.
def _acronym(word: str) -> str:
    return rf"(?<![A-Za-z]){word}(?![A-Za-z])"


BIG4_PATTERNS: dict[str, re.Pattern] = {
    "삼일": re.compile(rf"삼일회계법인|삼일\s*PwC|{_acronym('PwC')}", re.I),
    "삼정": re.compile(rf"삼정회계법인|삼정\s*KPMG|{_acronym('KPMG')}", re.I),
    # '안진회게법인' 오타 공고가 실제로 존재한다
    "안진": re.compile(rf"안진회[계게]법인|딜로이트|{_acronym('Deloitte')}", re.I),
    "한영": re.compile(rf"한영회계법인|EY\s*한영|{_acronym('EY')}", re.I),
}


def detect_big4(company_name: str, title: str = "") -> str | None:
    """빅4면 법인 이름('삼일'/'삼정'/'안진'/'한영'), 아니면 None."""
    haystack = f"{company_name} {title}"
    for name, pattern in BIG4_PATTERNS.items():
        if pattern.search(haystack):
            return name
    return None


# --------------------------------------------------------------------------
# 채용 유형
# --------------------------------------------------------------------------

# 상세 페이지 '경력' 필드가 이 값이면 경력직으로 확정한다.
CAREER_EXPERIENCED = re.compile(r"\d+\s*[~-]\s*\d+\s*년|\d+\s*년\s*이상")

ENTRY_PATTERNS = re.compile(
    r"수습|신입|"
    r"\d{2}\s*기\s*(합격|수습|공인회계사)|"      # '26기 합격자'
    r"(제?\s*\d{2}\s*회)?\s*합격자|"
    r"신규\s*공인회계사",
)

# 개업/파트너 모집 — 이미 개업한 회계사 대상이라 신입 대상이 아니다
PARTNER_PATTERNS = re.compile(
    r"개업|반개업|파트너|초빙|"
    r"팀\s*단위|기장으로\s*자리|"
    r"참여\s*회계사|영입"
)

EXPERIENCED_PATTERNS = re.compile(
    r"경력|\d+\s*년\s*차|\d+\s*년\s*이상|경험자|"
    r"\bexperienced\b|등록\s*회계사",
    re.I,
)

TYPE_ENTRY = "entry"
TYPE_EXPERIENCED = "experienced"
TYPE_PARTNER = "partner"
TYPE_AMBIGUOUS = "ambiguous"


def classify_posting_type(
    title: str, career: str = "", body: str = "", board: str = ""
) -> tuple[str, str]:
    """(유형, 판정 근거) 반환.

    우선순위: 게시판 > 신입 > 개업/파트너 > 경력 > 판단불가
    '수습 및 경력회계사' 처럼 둘 다 언급되면 신입을 우선한다.
    """
    # 구인(수습CPA) 게시판은 한공회가 "수습 회계사 및 공인회계사 시험 합격자
    # 대상" 으로만 등록을 받는다. 게시판 자체가 가장 강한 근거다.
    if board == "trainee":
        return TYPE_ENTRY, "구인(수습CPA) 게시판 등록"

    # 제목이 가장 신뢰도 높고, 본문은 앞부분만 본다 (뒤쪽 회사소개 오탐 방지)
    text = f"{title}\n{body[:600]}"

    if career.strip() == "신입":
        return TYPE_ENTRY, "경력 필드가 '신입'"

    m = ENTRY_PATTERNS.search(title)
    if m:
        return TYPE_ENTRY, f"제목에 '{m.group(0).strip()}'"

    m = PARTNER_PATTERNS.search(title)
    if m:
        return TYPE_PARTNER, f"제목에 '{m.group(0).strip()}' (개업/파트너 모집)"

    m = EXPERIENCED_PATTERNS.search(title)
    if m:
        return TYPE_EXPERIENCED, f"제목에 '{m.group(0).strip()}'"

    if CAREER_EXPERIENCED.search(career):
        return TYPE_EXPERIENCED, f"경력 필드가 '{career}'"

    m = ENTRY_PATTERNS.search(text)
    if m:
        return TYPE_ENTRY, f"본문에 '{m.group(0).strip()}'"

    m = PARTNER_PATTERNS.search(text)
    if m:
        return TYPE_PARTNER, f"본문에 '{m.group(0).strip()}' (개업/파트너 모집)"

    return TYPE_AMBIGUOUS, f"경력 필드 '{career or '없음'}', 제목에 단서 없음"


# --------------------------------------------------------------------------
# 직무
# --------------------------------------------------------------------------

JOB_TAX = "tax"
JOB_DEAL = "deal"
JOB_AUDIT = "audit"
JOB_ETC = "etc"

# 순서대로 검사한다. 감사는 마지막 — '회계감사'는 거의 모든 법인 소개문에 나와
# 먼저 검사하면 딜/택스 공고까지 감사로 끌어간다.
JOB_PATTERNS: list[tuple[str, re.Pattern]] = [
    (JOB_TAX, re.compile(r"\bTAX\b|세무|조세|세정|이전가격|\bTP\b|\bCTA\b|법인세|양도세", re.I)),
    (JOB_DEAL, re.compile(
        r"\bDeal\b|\bM&A\b|\bFAS\b|\bIB\b|밸류에이션|\bvaluation\b|가치평가|"
        r"재무자문|실사|\bDD\b|인수|매각|기업금융|\bTS\b|Transaction",
        re.I)),
    (JOB_AUDIT, re.compile(r"감사|\bAudit\b|\bAssurance\b|인증|품질관리", re.I)),
]


# 본문 전체를 훑으면 "회계감사, 세무와 경영컨설팅 등 다양한 업무를 제공" 같은
# 법인 소개문에 걸려 거의 모든 공고가 tax/audit 으로 분류된다.
# 업무를 실제로 서술하는 구간만 뽑아서 본다.
DUTY_SECTION = re.compile(
    r"(?:주요\s*업무|담당\s*업무|업무\s*내용|모집\s*분야|모집\s*부문|"
    r"채용\s*분야|채용\s*부문|담당\s*직무|직무\s*내용|업무\s*분야)"
    r"[^\n]{0,200}",
)


def extract_duty_text(body: str) -> str:
    """본문에서 업무를 서술하는 구간만 모아 반환한다."""
    return "\n".join(DUTY_SECTION.findall(body or ""))


def classify_job_category(title: str, body: str = "") -> tuple[str, str, str]:
    """(직무, 신뢰도, 판정 근거).

    신뢰도는 근거를 어디서 찾았는지에 따른다.
      high   제목 — 가장 믿을 만하다
      medium 본문의 업무 서술 구간
      low    본문 전체 — 법인 소개문에 걸렸을 수 있다
    """
    sources = (
        ("high", "제목", title),
        ("medium", "업무설명", extract_duty_text(body)),
        ("low", "본문", (body or "")[:1500]),
    )
    for confidence, source_name, text in sources:
        if not text:
            continue
        for category, pattern in JOB_PATTERNS:
            m = pattern.search(text)
            if m:
                return category, confidence, f"{source_name}에 '{m.group(0).strip()}'"
    return JOB_ETC, "high", "직무 키워드 없음"


# --------------------------------------------------------------------------
# 통합
# --------------------------------------------------------------------------

def is_expired(posting, today: date | None = None) -> bool:
    """마감된 공고인지. 게시판의 구직완료 구분과 마감일을 함께 본다.

    마감일이 지났는데도 '채용중' 으로 남아 있는 공고가 실제로 있다.
    """
    if getattr(posting, "is_closed", False):
        return True
    deadline = getattr(posting, "deadline", None)
    if deadline is None:
        return False
    return deadline < (today or date.today())


def classify(posting) -> dict:
    """Posting 을 분류해 라벨 dict 를 돌려주고 posting.labels 에도 넣는다."""
    big4 = detect_big4(posting.company_name, posting.title)
    ptype, type_reason = classify_posting_type(
        posting.title, posting.career, posting.body, getattr(posting, "board", "")
    )
    job, job_conf, job_reason = classify_job_category(posting.title, posting.body)

    labels = {
        "big4": big4,
        "is_big4": big4 is not None,
        "posting_type": ptype,
        "posting_type_reason": type_reason,
        "job_category": job,
        "job_category_confidence": job_conf,
        "job_category_reason": job_reason,
        # MVP 알림 대상: 빅4가 아니고, 신입이거나 판단 불가한 공고.
        # 이미 마감된 공고는 보내지 않는다.
        "is_target": (
            big4 is None
            and ptype in (TYPE_ENTRY, TYPE_AMBIGUOUS)
            and not is_expired(posting)
        ),
        "is_expired": is_expired(posting),
        "needs_review": ptype == TYPE_AMBIGUOUS,
    }
    posting.labels = labels
    return labels
