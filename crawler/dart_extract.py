"""회계법인 사업보고서 PDF 에서 수치를 뽑아 CSV 로 만든다.

    python crawler/dart_extract.py 세영회계법인      한 곳
    python crawler/dart_extract.py --verify         이미 만든 CSV 와 대조
    python crawler/dart_extract.py --all            PDF 는 있고 CSV 는 없는 곳 전부

금감원 표준 서식이라 표 구조가 법인마다 같다. 다만 텍스트 추출이라
쪽 경계에서 본문이 표 사이에 끼어드는 경우가 있어, 표를 통째로 읽지 않고
필요한 행만 골라낸다.

**파트너 수는 두 곳에서 나오고 서로 다를 수 있다.**
  인력총괄표의 '사원'  = 공인회계사인 출자자
  출자자 명단의 행 수  = 전체 출자자 (외국인 포함)
공인회계사법상 외국인은 회계사가 될 수 없지만 사원은 될 수 있어서다.
둘이 다르면 경고하고 사람이 확인하게 한다. 넘겨짚지 않는다.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "source"
DATA = ROOT / "data"

NUM = r"[\d,]+"
HEADERS = [
    "법인명", "브랜드", "기준연도", "매출액_억원", "감사매출_억원", "세무매출_억원",
    "딜자문매출_억원", "기타매출_억원", "감사비중_pct", "세무비중_pct",
    "딜자문비중_pct", "기타비중_pct", "회계사수", "수습CPA수", "파트너수",
    "본사소재지", "상장감사인등록", "현재대표이사", "보고서상대표이사",
    "주요감사고객_공개확인분", "비고",
]


def nfc(s: str) -> str:
    """macOS 는 한글을 자모로 분해해 저장한다. 합쳐진 형태로 되돌린다."""
    return unicodedata.normalize("NFC", s)


def read_pdf(path: Path) -> str:
    return "\n".join(p.extract_text() or "" for p in PdfReader(str(path)).pages)


def won_to_eok(v: str | None) -> float | None:
    """'9,380,400,000' → 93.80 (억원)."""
    if not v:
        return None
    return round(int(v.replace(",", "")) / 1e8, 2)


# ---------------------------------------------------------------------------
# 사업부문별 매출액
# ---------------------------------------------------------------------------

def parse_revenue(text: str) -> dict:
    """회계감사·세무자문·경영자문·기타 소계와 합계의 '당기' 값.

    표 머리글 표기가 법인마다 제각각이다.
      광교 '2025(당기)'   새빛 '27기(당기)'
      선일 '2025.06.30(당기)'  대주 '제32(당)기'  대현 '제 24 (당) 기'
    공통점은 '당' 이 들어간 줄 다음이 '금액 비중' 이라는 것뿐이다.

    소계를 나오는 순서로 짝지으면 부문이 빠진 법인에서 어긋난다.
    **바로 앞의 부문 이름으로 짝짓는다.**
    """
    # 기간 표기가 법인마다 다 다르다.
    #   '2025(당기)'  '27기(당기)'  '2025.06.30(당기)'  '제32(당)기'
    #   '당기 전기 전전기'  '제18기 제17기 제16기'
    # 변하지 않는 것은 그 다음 줄이 '금액 비중' 세 쌍이라는 점뿐이다.
    # 기간 표기가 한 줄이 아닐 수 있다. 신한은 여섯 줄에 걸쳐 적는다.
    #   구분 / 제57기(당기) / 2025.04.01~2026.03.31 / 제56기(전기) / ...
    # '금액 비중' 세 쌍이 나오기 전까지 여러 줄을 허용한다.
    head = None
    for m in re.finditer(
            r"구\s*분\s*\n(?:(?!구\s*분)[^\n]*\n){1,8}?"
            r"\s*금액\s+비중\s+금액\s+비중\s+금액\s+비중", text):
        head = m.start()
    if head is None:
        return {}

    SECTIONS = {"회계감사": "audit", "세무자문": "tax",
                "경영자문": "deal", "기타": "other"}
    # 전기·전전기 칸은 '-' 일 수 있다. 신설·분할된 부문이 그렇다.
    # 동현 2022.03 의 '기타' 소계가 '260,236,696 1.00 77,380,339 0.38 - -' 라
    # 세 기간 모두 숫자를 요구하면 이 부문이 통째로 0 이 된다.
    # 비중을 아예 안 적고 '-' 로 두는 법인이 있다(다산). 금액만 있으면
    # 비중은 합계로 나눠 채운다 — 보고서에 없는 값을 지어내는 게 아니라
    # 있는 값에서 계산하는 것이다.
    PAST = rf"(?:{NUM}|-)\s+(?:[\d.]+|-)"
    sub = re.compile(
        rf"^\s*소계\s+({NUM})\s+([\d.]+|-)\s+{PAST}\s+{PAST}\s*$")
    total = re.compile(
        rf"^\s*합계\s+({NUM})\s+([\d.]+|-)\s+{PAST}\s+{PAST}\s*$")

    # 부문명이 첫 행과 한 줄에 붙어 나오기도 한다
    # ('경영자문 감사대상회사 4,845,704,576 …').
    # 다만 '기타 486,071,372' 처럼 숫자가 따라오면 그건 소항목이지 부문이 아니다.
    section_head = re.compile(rf"^\s*({'|'.join(SECTIONS)})(?:\s+(?![\d,\-])|\s*$)")

    out: dict = {}
    current = None
    for line in text[head: head + 6000].split("\n"):
        m = section_head.match(line)
        if m:
            current = SECTIONS[m.group(1)]
            # 같은 줄에 소계가 오지는 않으므로 다음 줄로 넘어간다
            continue
        m = sub.match(line)
        if m and current:
            out[current] = won_to_eok(m.group(1))
            out[current + "_pct"] = None if m.group(2) == "-" else float(m.group(2))
            current = None
            continue
        m = total.match(line)
        if m:
            out["total"] = won_to_eok(m.group(1))
            break

    # 표에 없는 부문은 0 이다. 자료가 없는 것과 구분해야 한다.
    total_v = out.get("total")
    if total_v is not None:
        for key in SECTIONS.values():
            out.setdefault(key, 0.0)
            out.setdefault(key + "_pct", 0.0)
            # 보고서가 비중을 '-' 로 비워 둔 자리는 금액에서 계산한다
            if out[key + "_pct"] is None:
                out[key + "_pct"] = (round(out[key] / total_v * 100, 2)
                                     if total_v else 0.0)
    return out


# ---------------------------------------------------------------------------
# 인력
# ---------------------------------------------------------------------------

def parse_headcount(text: str) -> dict:
    """인력 총괄표의 맨 아래 합계 행.

    사원(이사) | 소속공인회계사(등록, 수습) | 소계 | 기타직원 | 합계

    빈 칸은 0 이 아니라 '-' 로 찍힌다. 수습뿐 아니라 등록·기타 어느 칸이든
    '-' 가 될 수 있어서 일곱 칸을 모두 같은 규칙으로 읽는다.

    표는 주사무소/분사무소/지점별로 행이 나뉘고 각 묶음마다 소계가 있다.
    묶음별 행은 '소계' 이고 '합계' 로 시작하는 행은 이 표에 하나뿐이다.
    창을 넓게 잡으면 다음 표의 합계까지 걸리므로 첫 번째만 쓴다.
    """
    idx = [m.start() for m in re.finditer("인력 총괄표", text)]
    if not idx:
        return {}
    # 사무소가 많으면 표가 길어진다. 넉넉히 잡고 마지막 합계 행을 쓴다.
    seg = text[idx[-1]: idx[-1] + 4000]
    rows = re.findall(
        r"^\s*합계((?:\s+(?:\d[\d,]*|-)){7})\s*$", seg, re.M)
    if not rows:
        return {}
    cells = [0 if c == "-" else int(c.replace(",", ""))
             for c in rows[0].split()]
    member, _director, registered, trainee, subtotal, _staff, _all = cells
    return {
        # CSV 의 '회계사수' 는 수습을 뺀 등록 회계사다 (사원 + 소속등록)
        "cpa": member + registered,
        "trainee": trainee,
        "member": member,          # 인력총괄표 기준 사원 수
        "cpa_total": subtotal,
    }


def count_foreign_partners(text: str) -> int:
    """출자자 명단에서 외국인을 센다.

    공인회계사법상 외국인은 공인회계사가 될 수 없지만 **사원(출자자)은 될 수
    있다.** 그래서 인력총괄표의 '사원'(공인회계사 기준)과 실제 출자자 수가
    다를 수 있다. 새빛회계법인의 Julien Herveau 가 그런 경우다.

    명단 행을 통째로 세는 방식은 직위 서식이 자유로워 자꾸 어긋났다.
    라틴 문자 이름만 찾는 편이 훨씬 안정적이다.
    가려진 이름('오OO')은 대문자 O 뿐이므로 소문자를 요구해 걸러낸다.
    """
    idx = [m.start() for m in re.finditer("이사의 경력 현황", text)]
    if not idx:
        return 0
    seg = text[idx[-1]: idx[-1] + 20000]
    end = re.search(r"\n\s*(다\.\s|3\.\s공인회계사|공인회계사 변동)", seg)
    if end:
        seg = seg[: end.start()]

    names = set()
    for m in re.finditer(r"^\s*\d{1,3}\s+([A-Za-z][A-Za-z\.\- ]{2,40}?)\s+\S", seg, re.M):
        name = m.group(1).strip()
        if re.search(r"[a-z]", name):      # 가려진 이름(OO)은 제외
            names.add(name)
    return len(names)


# ---------------------------------------------------------------------------
# 그 밖
# ---------------------------------------------------------------------------

def parse_address(text: str) -> str | None:
    m = re.search(r"(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충[北북남청]"
                  r"|전[北북남라]|경[北북남상]|제주)[^\n]{5,90}", text)
    return m.group(0).strip() if m else None


def parse_ceo(text: str) -> str | None:
    idx = [m.start() for m in re.finditer("이사의 경력 현황", text)]
    if not idx:
        return None
    m = re.search(r"^\s*1\s+(\S+(?:\s\S+)?)\s+대표이사", text[idx[-1]:], re.M)
    return m.group(1).strip() if m else None


def canonical_firm_name(raw: str) -> str:
    """보고서 표지의 법인명을 하나의 표기로 맞춘다.

    '(유)정일회계법인' '회계법인 세일원' '회계법인리안' 이 전부 나온다.
    법적 형태 표기를 떼고 접두사형을 접미사형으로 돌려놓는다.
    """
    name = nfc(raw).strip()
    name = re.sub(r"^\((?:유|주|합|유한)\)\s*", "", name)
    name = re.sub(r"\s+", "", name)
    m = re.match(r"^회계법인(.+)$", name)
    if m:
        name = f"{m.group(1)}회계법인"
    return name


def parse_firm_name(text: str) -> str | None:
    """표지의 '회계법인명 : XXX'.

    폴더 이름은 우리가 찾을 때 쓴 검색어라 실제 법인명과 다를 수 있다.
    DART 는 **옛 이름으로 검색해도 지금 법인을 돌려준다.** 그래서
    '영앤진회계법인' 을 찾으면 동현회계법인의 보고서가 온다. 폴더 이름을
    믿으면 같은 법인이 두 이름으로 중복 등록된다.
    """
    m = re.search(r"회계법인명\s*:\s*([^\n]+)", text)
    return canonical_firm_name(m.group(1)) if m else None


def parse_listed_auditor(text: str) -> str:
    return "O" if re.search(r"상장회사\s*감사인\s*등록", text) else "X"


def parse_brand(text: str) -> str | None:
    """외국 회계법인과의 제휴 현황."""
    idx = [m.start() for m in re.finditer("외국 회계법인과의 제휴 현황", text)]
    if not idx:
        return None
    seg = text[idx[-1]: idx[-1] + 400]
    if re.search(r"해당\s*사항\s*없|없습니다|^\s*-\s*$", seg, re.M):
        return None
    m = re.search(r"\n\s*([A-Za-z][A-Za-z&\.\- ]{3,40})\s*\n", seg)
    return m.group(1).strip() if m else None


# ---------------------------------------------------------------------------

_PERIOD = re.compile(
    r"사업연도\s*\n?\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*부터"
    r"\s*\n?\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*까지")


def fiscal_period(text: str) -> tuple[str, str, int] | None:
    """(시작 'YYYY.MM', 종료 'YYYY.MM', 개월수).

    표지의 '사업연도 ... 부터 ... 까지' 가 유일하게 믿을 수 있는 출처다.
    '제N기 YYYY년 MM월 DD일' 만 보면 법인마다 시작일이 잡히기도 하고
    종료일이 잡히기도 한다 — 세영은 5개 기수 중 4개가 시작일로 읽혔다.
    """
    m = _PERIOD.search(text)
    if not m:
        return None
    y0, m0, _, y1, m1, _ = (int(x) for x in m.groups())
    months = (y1 - y0) * 12 + (m1 - m0) + 1
    return f"{y0}.{m0:02d}", f"{y1}.{m1:02d}", months


def fiscal_year(path: Path, text: str | None = None) -> str | None:
    """결산기(예 '2026.03') — 사업연도의 **종료** 시점.

    파일명은 믿을 수 없다. 직접 받은 파일은 '(2026.06.30)' 처럼 **제출일**이
    들어 있고, 이 도구가 받은 파일은 '(2026.03)' 처럼 결산기가 들어 있다.
    """
    if text:
        p = fiscal_period(text)
        if p:
            return p[1]
        m = re.search(r"제\s*\d+\s*기\s*[:\s]*(\d{4})\s*년\s*(\d{1,2})\s*월\s*\d{1,2}\s*일",
                      text)
        if m:
            return f"{m.group(1)}.{int(m.group(2)):02d}"
    m = re.search(r"\((\d{4})\.(\d{2})\)", nfc(path.name))
    return f"{m.group(1)}.{m.group(2)}" if m else None


def extract_one(path: Path, firm: str) -> dict:
    text = read_pdf(path)
    period = fiscal_period(text)
    rev = parse_revenue(text)
    hc = parse_headcount(text)
    listed = parse_listed_auditor(text)
    # 파트너 = 공인회계사인 사원 + 외국인 사원
    foreign = count_foreign_partners(text)
    member = hc.get("member")
    partners = (member + foreign) if member is not None else None

    return {
        "법인명": firm,
        "브랜드": parse_brand(text) or "",
        "기준연도": fiscal_year(path, text) or "",
        "매출액_억원": rev.get("total"),
        "감사매출_억원": rev.get("audit"),
        "세무매출_억원": rev.get("tax"),
        "딜자문매출_억원": rev.get("deal"),
        "기타매출_억원": rev.get("other"),
        "감사비중_pct": rev.get("audit_pct"),
        "세무비중_pct": rev.get("tax_pct"),
        "딜자문비중_pct": rev.get("deal_pct"),
        "기타비중_pct": rev.get("other_pct"),
        "회계사수": hc.get("cpa"),
        "수습CPA수": hc.get("trainee"),
        "파트너수": partners,
        "본사소재지": parse_address(text) or "",
        "상장감사인등록": listed,
        "현재대표이사": parse_ceo(text) or "",
        "보고서상대표이사": parse_ceo(text) or "",
        "주요감사고객_공개확인분": "",
        "비고": "딜자문은 사업보고서상 '경영자문' 기준",
        # 검증용 (CSV 에는 안 넣는다)
        "_member": member,
        "_foreign": foreign,
        "_cpa_total": hc.get("cpa_total"),
        "_보고서법인명": parse_firm_name(text),
        "_months": period[2] if period else None,
    }


def extract_firm(firm: str) -> list[dict]:
    folder = next((d for d in SOURCE.iterdir()
                   if d.is_dir() and nfc(d.name) == nfc(firm)), None)
    if not folder:
        print(f"❌ source/{firm} 폴더가 없습니다.")
        return []
    pdfs = sorted(folder.glob("*.pdf"), key=lambda p: nfc(p.name))
    if not pdfs:
        print(f"❌ {firm}: PDF 가 없습니다.")
        return []

    rows = []
    for p in pdfs:
        try:
            rows.append(extract_one(p, nfc(firm)))
        except Exception as exc:
            print(f"   ⚠️  {nfc(p.name)[:44]} — {type(exc).__name__}: {exc}")

    # 결산기를 바꾼 해에는 몇 달짜리 사업연도가 하나 낀다. 선일은 결산기를
    # 3월에서 6월로 옮기면서 제6기가 2022.04~06 석 달뿐이다(29.84억).
    # 이걸 한 해로 세면 추이 차트에 매출이 폭락한 것처럼 보인다.
    full = [r for r in rows if (r.get("_months") or 12) >= 11]
    for r in rows:
        if r not in full:
            print(f"   ⏭️  {r['기준연도']} 는 {r['_months']}개월 결산(결산기 변경)이라 뺍니다"
                  f" — 매출 {r['매출액_억원']}억")
    full.sort(key=lambda r: r["기준연도"])

    # 법인 이름은 **가장 최근 보고서**의 것을 쓴다. 개명한 곳이 있다.
    # 대성삼경 → 대성(2025), 진일 → 태일(2025). 폴더 이름은 우리가 찾을 때
    # 쓴 검색어일 뿐이라 지금 이름이 아닐 수 있다.
    identity = next((r["_보고서법인명"] for r in reversed(full)
                     if r.get("_보고서법인명")), None)
    if identity and identity != nfc(firm):
        print(f"   ℹ️  보고서상 법인명은 '{identity}' (폴더는 '{nfc(firm)}')")
    for r in full:
        r["법인명"] = identity or nfc(firm)
    return full


def write_csv(firm: str, rows: list[dict]) -> Path:
    DATA.mkdir(exist_ok=True)
    path = DATA / f"{firm}_5개년_정리.csv"
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=HEADERS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return path


# ---------------------------------------------------------------------------
# 검산 — 대조본 없이 스스로 걸러낸다
#
# 손으로 만든 CSV 가 있는 법인은 다섯 곳뿐이다. 나머지 300 곳은 대조할
# 것이 없으므로 "추출이 성공한 척하고 틀린 값을 내놓는" 경우를 보고서
# 안에서 잡아야 한다. 다행히 사업보고서에는 서로 맞아떨어져야 하는
# 값이 여럿 있다.
#
#   부문 매출의 합 == 합계        (성현의 잘못된 수기 CSV 를 잡은 규칙)
#   부문 비중의 합 == 100
#   사원 + 등록 + 수습 == 소계     (71 개 보고서에서 예외 없이 성립)
#
# 어긋나면 그 행은 DB 에 넣지 않고 격리한다. 빈칸으로 통과시키면
# 실명 법인 페이지에 틀린 매출액이 올라간다.
# ---------------------------------------------------------------------------

HARD, SOFT = "격리", "확인"

# 반올림 때문에 정확히 0 이 되지는 않는다. 정상 71 행의 최대 오차가
# 0.02% 였다. 0.5% 는 반올림은 통과시키고 부문 누락은 잡는 폭이다.
TOL_SUM_PCT = 0.5      # 부문합 vs 합계 (%)
TOL_PCT_POINT = 0.5    # 비중합 vs 100 (%p)
SWING_PCT = 60.0       # 전년 대비 매출 급변 (합병·분할·결산기 변경 신호)

PARTS = ["감사매출_억원", "세무매출_억원", "딜자문매출_억원", "기타매출_억원"]
PART_PCTS = ["감사비중_pct", "세무비중_pct", "딜자문비중_pct", "기타비중_pct"]


def check_row(r: dict) -> list[tuple[str, str]]:
    """한 해치 값의 자체 모순을 찾는다. [(등급, 사유)] 를 돌려준다."""
    out = []
    year = r.get("기준연도") or "?"

    if not re.fullmatch(r"\d{4}\.\d{2}", year):
        out.append((HARD, f"기준연도를 못 읽음({year!r})"))

    total = r.get("매출액_억원")
    if total is None:
        out.append((HARD, "매출액 없음"))
    elif total <= 0:
        out.append((HARD, f"매출액이 0 이하({total})"))
    else:
        parts = [r.get(k) for k in PARTS]
        if any(v is None for v in parts):
            out.append((HARD, "부문별 매출에 빈 값"))
        else:
            gap = abs(sum(parts) - total) / total * 100
            if gap > TOL_SUM_PCT:
                out.append((HARD, f"부문합 {sum(parts):.2f} ≠ 합계 {total:.2f} "
                                  f"({gap:.2f}% 차이)"))
        pcts = [r.get(k) for k in PART_PCTS]
        if all(v is not None for v in pcts):
            gap = abs(sum(pcts) - 100)
            if gap > TOL_PCT_POINT:
                out.append((HARD, f"비중합 {sum(pcts):.2f} ≠ 100 ({gap:.2f}%p 차이)"))

    cpa, tr = r.get("회계사수"), r.get("수습CPA수")
    member, subtotal = r.get("_member"), r.get("_cpa_total")
    if cpa is None:
        out.append((HARD, "회계사 수 없음"))
    elif None not in (tr, member, subtotal):
        # 사원 + 등록 + 수습 == 인력총괄표 소계
        if (cpa + tr) != subtotal:
            out.append((HARD, f"인력 소계 안 맞음: 회계사 {cpa} + 수습 {tr} "
                              f"≠ 소계 {subtotal}"))

    partners = r.get("파트너수")
    if partners is not None and cpa is not None and partners > cpa:
        out.append((SOFT, f"파트너 {partners} > 회계사 {cpa}"))

    return out


def check_series(rows: list[dict]) -> dict[str, list[tuple[str, str]]]:
    """여러 해를 나란히 놓고 본다. 기준연도별 사유를 돌려준다."""
    out: dict[str, list[tuple[str, str]]] = {}
    seen: dict[str, int] = {}
    prev = None
    for r in sorted(rows, key=lambda x: x.get("기준연도") or ""):
        year = r.get("기준연도") or "?"
        seen[year] = seen.get(year, 0) + 1
        if seen[year] > 1:
            out.setdefault(year, []).append((HARD, f"기준연도 {year} 가 중복"))

        cur = r.get("매출액_억원")
        if prev and cur and prev[1]:
            swing = (cur - prev[1]) / prev[1] * 100
            if abs(swing) > SWING_PCT:
                out.setdefault(year, []).append(
                    (SOFT, f"{prev[0]} 대비 매출 {swing:+.0f}%"))
        if cur:
            prev = (year, cur)
    return out


def audit_rows(firm: str, rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """검산해서 (통과, 격리) 로 가른다. 격리 사유는 행에 붙여 둔다."""
    series = check_series(rows)
    clean, held = [], []
    for r in rows:
        issues = check_row(r) + series.get(r.get("기준연도") or "?", [])
        hard = [m for lvl, m in issues if lvl == HARD]
        soft = [m for lvl, m in issues if lvl == SOFT]
        for m in soft:
            print(f"   ⚠️  {r.get('기준연도')} {m}")
        if hard:
            r["_격리사유"] = " / ".join(hard)
            for m in hard:
                print(f"   ⛔ {r.get('기준연도')} {m}")
            held.append(r)
        else:
            clean.append(r)
    if len(rows) < 5:
        print(f"   ⚠️  {len(rows)}개년뿐 (5개년 미만)")
    return clean, held


def write_quarantine(firm: str, held: list[dict]) -> Path:
    """격리된 행은 따로 남긴다. 서식을 고칠 때 여기부터 본다."""
    folder = DATA / "_격리"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{firm}.csv"
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=HEADERS + ["_격리사유"],
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(held)
    return path


# ---------------------------------------------------------------------------
# 검증 — 손으로 만든 CSV 와 대조한다
# ---------------------------------------------------------------------------

CHECK_FIELDS = ["매출액_억원", "감사매출_억원", "세무매출_억원", "딜자문매출_억원",
                "기타매출_억원", "회계사수", "수습CPA수", "파트너수"]


def load_manual(firm: str) -> dict[str, dict]:
    """손으로 만든 CSV. 기준연도별로 담는다.

    **source/<법인>/ 안만 본다.** data/ 는 이 도구가 CSV 를 내놓는 곳이라
    거기까지 뒤지면 --write 를 한 번 돌린 뒤부터 자기 출력과 자기를
    비교하게 된다. 그러면 무슨 값을 뽑든 항상 전부 일치로 나온다.
    """
    for folder in (SOURCE / firm,):
        for p in folder.glob(f"*{firm}*.csv") if folder.exists() else []:
            rows = list(csv.DictReader(p.open(encoding="utf-8-sig")))
            if rows and "기준연도" in rows[0]:
                return {r["기준연도"].strip(): r for r in rows}
    return {}


def verify(firm: str, rows: list[dict]) -> tuple[int, int]:
    manual = load_manual(firm)
    if not manual:
        print(f"   (대조할 CSV 없음)")
        return 0, 0

    ok = bad = 0
    for r in rows:
        year = r["기준연도"]
        m = manual.get(year)
        if not m:
            continue
        for f in CHECK_FIELDS:
            got, want = r.get(f), (m.get(f) or "").strip()
            if want in ("", "-"):
                continue
            same = abs(float(got) - float(want)) < 0.02 if got is not None else False
            if same:
                ok += 1
            else:
                bad += 1
                note = ""
                if f == "파트너수" and r.get("_member") is not None:
                    note = f"  (사원={r['_member']} + 외국인={r['_foreign']})"
                print(f"   ❌ {year} {f}: 추출 {got} vs 기존 {want}{note}")
    return ok, bad


def firms_with_pdf(only_missing_csv: bool = True) -> list[str]:
    out = []
    for d in sorted(SOURCE.iterdir()):
        if not d.is_dir() or not list(d.glob("*.pdf")):
            continue
        if only_missing_csv and list(d.glob("*.csv")):
            continue
        out.append(nfc(d.name))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="사업보고서 PDF → CSV")
    ap.add_argument("firms", nargs="*")
    ap.add_argument("--verify", action="store_true",
                    help="이미 CSV 가 있는 법인으로 추출 정확도를 확인한다")
    ap.add_argument("--all", action="store_true", help="CSV 없는 법인 전부")
    ap.add_argument("--write", action="store_true", help="CSV 파일로 저장")
    ap.add_argument("--check", action="store_true",
                    help="검산만 돌린다 (파일을 쓰지 않는다)")
    args = ap.parse_args()

    if args.verify:
        targets = [nfc(d.name) for d in sorted(SOURCE.iterdir())
                   if d.is_dir() and list(d.glob("*.csv"))]
    elif args.check and not args.firms:
        targets = firms_with_pdf(only_missing_csv=False)
    elif args.all:
        targets = firms_with_pdf()
    else:
        targets = [nfc(f) for f in args.firms]

    if not targets:
        print("대상이 없습니다."); return 1

    total_ok = total_bad = 0
    total_clean = total_held = 0
    held_firms = []
    # 같은 법인이 두 폴더로 들어오는 일이 잦다. DART 가 옛 이름 검색에도
    # 지금 법인을 돌려주기 때문이다(영앤진→동현, 성도이현→성현,
    # 동아송강→동성, 예교지성→예지). 보고서상 법인명으로 걸러낸다.
    seen: dict[str, str] = {}
    dupes: list[tuple[str, str]] = []
    for firm in targets:
        print(f"── {firm}")
        rows = extract_firm(firm)
        if not rows:
            print(); continue

        identity = rows[0]["법인명"]
        if identity in seen and seen[identity] != firm:
            print(f"   ⛔ '{seen[identity]}' 와 같은 법인({identity}) — 건너뜁니다")
            dupes.append((firm, seen[identity]))
            total_held += len(rows); held_firms.append(firm)
            print(); continue
        seen[identity] = firm

        for r in rows:
            print(f"   {r['기준연도']}  매출 {str(r['매출액_억원']):>7}억  "
                  f"회계사 {str(r['회계사수']):>3}명  수습 {str(r['수습CPA수']):>2}명  "
                  f"파트너 {str(r['파트너수']):>3}명")

        # 검산은 늘 돈다. 격리된 행은 CSV 로 내보내지 않는다.
        clean, held = audit_rows(firm, rows)
        total_clean += len(clean); total_held += len(held)
        if held:
            held_firms.append(firm)

        if args.verify:
            ok, bad = verify(firm, rows)
            total_ok += ok; total_bad += bad
            print(f"   → 일치 {ok} / 불일치 {bad}")
        elif args.write:
            if clean:
                print(f"   → {write_csv(firm, clean)}")
            if held:
                print(f"   ⛔ 격리 {len(held)}행 → {write_quarantine(firm, held)}")
        print()

    print(f"검산: 통과 {total_clean}행 / 격리 {total_held}행")
    if held_firms:
        print(f"   격리된 법인: {', '.join(held_firms)}")
    if dupes:
        print(f"   중복 {len(dupes)}곳: "
              + ", ".join(f"{a}={b}" for a, b in dupes))

    if args.verify:
        print(f"대조: 일치 {total_ok} / 불일치 {total_bad}")
        return 0 if total_bad == 0 else 1
    if args.check:
        return 0 if total_held == 0 else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
