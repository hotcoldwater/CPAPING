"""한국공인회계사회(한공회) 구인정보 게시판 수집.

한공회는 구인 게시판을 여러 개로 나눠 운영한다. MVP 가 노리는 신입/수습
공고는 대부분 '구인(수습CPA)' 게시판에 모여 있다.

  trainee  구인(수습CPA)  /home/jobOffrSrchNewGnrl/  ← 주 수집 대상
  cpa      구인(CPA)      /home/jobOffrSrchGnrl/     ← 경력 위주. 신입 공고가
                                                       섞여 올라오기도 한다

두 게시판은 목록 컬럼 구성이 다르므로(수습CPA 쪽에 '구직완료 구분',
'고용형태'가 더 있다) 컬럼 위치를 고정하지 않고 헤더를 읽어 매핑한다.

수습CPA 게시판은 등록 1개월이 지난 글이 자동 삭제되므로, 놓친 공고를
나중에 복구할 수 없다. 폴링이 끊기지 않는 것이 중요하다.

robots.txt 는 전체 허용(Allow: /)이나, 상대 서버 배려를 위해
요청 사이에 지연을 둔다.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime

import requests
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

BASE = "https://www.kicpa.or.kr"

BOARD_TRAINEE = "trainee"
BOARD_CPA = "cpa"

# 게시판 코드 → (URL 경로, 사람이 읽는 이름)
BOARDS: dict[str, tuple[str, str]] = {
    BOARD_TRAINEE: ("jobOffrSrchNewGnrl", "구인(수습CPA)"),
    BOARD_CPA: ("jobOffrSrchGnrl", "구인(CPA)"),
}

# 회사구분: 1=회계법인, 2=회계사무소, 3=공공기관, 4=일반기업, 5=헤드헌터
CO_SEP_ACCOUNTING_FIRM = "1"
# 채용구분(직급): 1=회계사, 2=평직원, 3=대리급, 4=과장급
JOB_SEP_CPA = "1"


def list_url(board: str) -> str:
    return f"{BASE}/home/{BOARDS[board][0]}/list.face"


def detail_url(board: str) -> str:
    return f"{BASE}/home/{BOARDS[board][0]}/detail.face"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

REQUEST_DELAY_SEC = 1.0
TIMEOUT_SEC = 20


@dataclass
class Posting:
    """공고 1건. 목록에서 채운 뒤 상세로 보강한다."""

    # --- 목록에서 ---
    board: str = BOARD_TRAINEE          # 어느 게시판에서 왔는지
    seq: int | None = None              # 게시판 번호
    ij_id: str = ""                     # 상세 조회용 ID (ijIdNum)
    title: str = ""
    company_name: str = ""
    region: str = ""
    recruit_type: str = ""              # 채용구분 (회계사 등) — CPA 게시판만
    hiring_status: str = ""             # 구직완료 구분 (채용중/마감) — 수습 게시판만
    posted_at: date | None = None
    view_count: int | None = None

    # --- 상세에서 ---
    # 공고에 적힌 담당자 이름·전화번호·이메일은 수집하지 않는다.
    # 개인 휴대폰과 개인 메일 주소가 섞여 있는데, 우리가 이를 따로 보관하고
    # 알림 메일로 재배포할 이유가 없다. 지원자는 원문 링크에서 확인하면 된다.
    detail_fetched: bool = False
    co_sep: str = ""                    # 회사구분
    homepage: str = ""                  # 법인 홈페이지 (개인정보 아님)
    headcount: str = ""                 # 채용인원
    employment_type: str = ""           # 고용형태
    work_region: str = ""               # 근무지역
    career: str = ""                    # 경력 (무관/신입/1~3년 ...)
    salary: str = ""
    education: str = ""
    deadline: date | None = None
    body: str = ""

    # --- 분류 결과 (classify.py 가 채움) ---
    labels: dict = field(default_factory=dict)

    @property
    def detail_url(self) -> str:
        return f"{detail_url(self.board)}?ijIdNum={self.ij_id}"

    @property
    def source(self) -> str:
        """중복 판정 키의 일부. 게시판마다 번호가 따로 매겨진다."""
        return f"kicpa:{self.board}"

    @property
    def is_closed(self) -> bool:
        """게시판이 스스로 끝났다고 표시한 공고.

        '구직완료 구분' 컬럼 값이다. 지금까지 본 값은 '채용중' 뿐이지만,
        법인이 '채용완료' 로 바꾸면 글이 내려가지 않고 상태만 바뀔 수 있다.
        '마감' 만 보면 그걸 놓친다.
        """
        status = self.hiring_status or ""
        return any(word in status for word in ("마감", "완료", "종료"))


def _clean(text: str) -> str:
    """연속 공백을 하나로 줄이고 앞뒤를 다듬는다."""
    return " ".join(text.split())


def _parse_date(text: str) -> date | None:
    """'2026.08.30' 형태를 date 로. 실패하면 None."""
    m = re.search(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", text or "")
    if not m:
        return None
    try:
        return date(*(int(g) for g in m.groups()))
    except ValueError:
        return None


def _parse_int(text: str) -> int | None:
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else None


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "ko-KR,ko;q=0.9"})
    return s


# --------------------------------------------------------------------------
# 목록
# --------------------------------------------------------------------------

# 목록 헤더 라벨 → Posting 속성명. 게시판마다 컬럼 구성이 달라
# 위치가 아니라 헤더로 찾는다.
_LIST_COLUMNS = {
    "번호": "seq",
    "제목": "title",
    "회사명": "company_name",
    "지역": "region",
    "채용구분": "recruit_type",
    "구직완료구분": "hiring_status",
    "고용형태": "employment_type",
    "등록일자": "posted_at",
    "조회수": "view_count",
}

_INT_COLUMNS = {"seq", "view_count"}
_DATE_COLUMNS = {"posted_at"}


def _column_map(table) -> dict[int, str]:
    """헤더 행을 읽어 {컬럼 인덱스: 속성명} 을 만든다."""
    header_cells = table.select("thead th") or table.select("tr th")
    mapping = {}
    for i, th in enumerate(header_cells):
        label = _clean(th.get_text()).replace(" ", "")
        if label in _LIST_COLUMNS:
            mapping[i] = _LIST_COLUMNS[label]
    return mapping


def parse_list(html: str, board: str = BOARD_TRAINEE) -> list[Posting]:
    """목록 페이지 HTML → Posting 리스트 (목록 필드만 채움)."""
    soup = BeautifulSoup(html, "lxml")
    postings: list[Posting] = []

    for a in soup.select("a.subject_title"):
        row = a.find_parent("tr")
        table = a.find_parent("table")
        if row is None or table is None:
            continue

        columns = _column_map(table)
        if not columns:
            log.warning("목록 헤더를 읽지 못했습니다 — 사이트 구조가 바뀌었을 수 있습니다")
            continue

        onclick = a.get("onclick", "")
        m = re.search(r"fn_detail\(\s*['\"]([^'\"]+)['\"]\s*\)", onclick)
        if not m:
            log.warning("fn_detail ID 추출 실패: %r", onclick)
            continue

        posting = Posting(board=board, ij_id=m.group(1), title=_clean(a.get_text()))
        cells = row.find_all("td")
        for index, attr in columns.items():
            if index >= len(cells) or attr == "title":
                continue
            raw = _clean(cells[index].get_text())
            if attr in _INT_COLUMNS:
                setattr(posting, attr, _parse_int(raw))
            elif attr in _DATE_COLUMNS:
                setattr(posting, attr, _parse_date(raw))
            else:
                setattr(posting, attr, raw)

        postings.append(posting)

    return postings


def parse_total_count(html: str) -> int | None:
    """'(총 17 건)' 에서 전체 건수를 뽑는다."""
    m = re.search(r"총\s*([\d,]+)\s*건", html)
    return int(m.group(1).replace(",", "")) if m else None


def fetch_list(
    session: requests.Session,
    *,
    board: str = BOARD_TRAINEE,
    page: int = 1,
    list_cnt: int = 50,
    co_sep: str | None = None,
    job_sep: str | None = None,
) -> tuple[list[Posting], int | None]:
    """목록 한 페이지를 가져온다. (공고 리스트, 전체 건수) 반환.

    co_sep / job_sep 을 주면 서버 쪽 필터를 건다. 수습CPA 게시판은
    전체가 17건 남짓이라 필터 없이 다 받는 편이 낫다.
    """
    params = {"listCnt": str(list_cnt), "page": str(page)}
    if co_sep:
        params["ijCoSep"] = co_sep
    if job_sep:
        params["ijJobSep"] = job_sep

    res = session.get(list_url(board), params=params, timeout=TIMEOUT_SEC)
    res.raise_for_status()
    res.encoding = "utf-8"
    return parse_list(res.text, board), parse_total_count(res.text)


# --------------------------------------------------------------------------
# 상세
# --------------------------------------------------------------------------

# 상세 페이지 th 라벨 → Posting 속성명
# '담당자' / '전화번호' / '이메일' 은 일부러 뺐다. Posting 주석 참고.
_DETAIL_FIELDS = {
    "회사구분": "co_sep",
    "회사명": "company_name",
    "홈페이지": "homepage",
    "채용인원": "headcount",
    "고용형태": "employment_type",
    "근무지역": "work_region",
    "경력": "career",
    "급여조건": "salary",
    "학력": "education",
}


def parse_detail(html: str, posting: Posting) -> Posting:
    """상세 페이지 HTML 로 Posting 을 보강한다."""
    soup = BeautifulSoup(html, "lxml")

    for tr in soup.select("table.table_st02 tr"):
        cells = tr.find_all(["th", "td"])
        # th, td 가 번갈아 나오는 구조
        for th, td in zip(cells, cells[1:]):
            if th.name != "th" or td.name != "td":
                continue
            label = _clean(th.get_text())
            value = _clean(td.get_text())
            if label == "제목" and value:
                posting.title = value
            elif label == "마감일":
                posting.deadline = _parse_date(value)
            elif label in _DETAIL_FIELDS:
                if value and value != "-":
                    setattr(posting, _DETAIL_FIELDS[label], value)

    # 본문: th 가 없는 테이블의 첫 td
    for tbl in soup.select("table.table_st02"):
        if tbl.find("th") is None:
            td = tbl.find("td")
            if td:
                posting.body = td.get_text("\n", strip=True)
                break

    posting.detail_fetched = True
    return posting


def fetch_detail(session: requests.Session, posting: Posting) -> Posting:
    """상세 페이지를 가져와 Posting 을 보강한다."""
    res = session.get(
        detail_url(posting.board),
        params={"ijIdNum": posting.ij_id},
        timeout=TIMEOUT_SEC,
    )
    res.raise_for_status()
    res.encoding = "utf-8"
    return parse_detail(res.text, posting)


# --------------------------------------------------------------------------
# 통합
# --------------------------------------------------------------------------

def fetch_postings(
    session: requests.Session | None = None,
    *,
    board: str = BOARD_TRAINEE,
    max_pages: int = 2,
    list_cnt: int = 50,
    with_detail: bool = True,
    co_sep: str | None = None,
    job_sep: str | None = None,
    delay: float = REQUEST_DELAY_SEC,
) -> list[Posting]:
    """게시판 하나를 수집한다.

    with_detail: 상세 페이지까지 조회할지 (마감일/본문/연락처 확보)
    """
    session = session or make_session()
    postings: list[Posting] = []

    for page in range(1, max_pages + 1):
        page_items, total = fetch_list(
            session,
            board=board,
            page=page,
            list_cnt=list_cnt,
            co_sep=co_sep,
            job_sep=job_sep,
        )
        log.info(
            "%s %d페이지: %d건 (전체 %s건)",
            BOARDS[board][1], page, len(page_items), total,
        )
        if not page_items:
            break
        postings.extend(page_items)
        if total is not None and len(postings) >= total:
            break
        time.sleep(delay)

    if with_detail:
        for i, p in enumerate(postings, 1):
            try:
                fetch_detail(session, p)
            except requests.RequestException as exc:
                log.warning("상세 조회 실패 (%s): %s", p.ij_id, exc)
            if i < len(postings):
                time.sleep(delay)
        log.info("%s 상세 조회 완료: %d건", BOARDS[board][1], len(postings))

    return postings


def fetch_all_boards(
    session: requests.Session | None = None,
    *,
    boards: list[str] | None = None,
    with_detail: bool = True,
    delay: float = REQUEST_DELAY_SEC,
) -> list[Posting]:
    """여러 게시판을 순서대로 수집한다.

    구인(CPA) 게시판은 128건 규모라 상세를 매번 다 긁으면 부담이 크다.
    실제 운영에서는 신규 건만 상세를 조회하도록 store 계층에서 걸러낸다.
    """
    session = session or make_session()
    boards = boards or [BOARD_TRAINEE, BOARD_CPA]
    result: list[Posting] = []
    for board in boards:
        result.extend(
            fetch_postings(
                session,
                board=board,
                with_detail=with_detail,
                # CPA 게시판은 회계법인 + 회계사 공고만
                co_sep=CO_SEP_ACCOUNTING_FIRM if board == BOARD_CPA else None,
                job_sep=JOB_SEP_CPA if board == BOARD_CPA else None,
                delay=delay,
            )
        )
    return result
