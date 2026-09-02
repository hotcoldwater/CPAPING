"""상장사의 외부감사인을 모아 회계법인별 고객 목록을 만든다.

    python crawler/dart_auditors.py --limit 100        시범
    python crawler/dart_auditors.py --market KOSPI     코스피만
    python crawler/dart_auditors.py --all --write      전부 받아 CSV 로

회계법인 사업보고서에는 고객사 명단이 없다. 대신 **회사 쪽 사업보고서**에
'V. 회계감사인의 감사의견 등' 이 반드시 들어간다. 상장사를 훑어 그 절만
읽고 뒤집으면 회계법인별 고객 목록이 나온다.

사업보고서 전체는 수 MB 지만 그 절만 따로 받을 수 있어 70KB 안팎이다.
그래서 2,600 곳을 훑어도 부담이 크지 않다.

  ① 상장사 목록          KIND 상장법인목록
  ② 회사명 → 회사코드     dsae001/search.ax
  ③ 회사코드 → 사업보고서  dsab007/detailSearch.ax
  ④ 보고서 → 절 목록      dsaf001/main.do      ← 감사의견 절의 offset/length
  ⑤ 절만 내려받기         report/viewer.do     ← 여기서 감사인을 읽는다
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import time
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://dart.fss.or.kr"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
DELAY = 0.7
TIMEOUT = 40

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

nfc = lambda s: unicodedata.normalize("NFC", s or "")


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Referer": BASE})
    return s


# ---------------------------------------------------------------------------
# 상장사 목록
# ---------------------------------------------------------------------------

def listed_companies(s: requests.Session, market: str | None = None) -> list[dict]:
    """KIND 상장법인목록. 회사명·종목코드·시장구분을 준다.

    엑셀 내려받기 주소가 그대로 HTML 표를 돌려준다. 인증이 필요 없다.
    """
    url = "https://kind.krx.co.kr/corpgeneral/corpList.do"
    params = {"method": "download", "pageIndex": 1, "currentPageSize": 5000,
              "orderMode": 3, "orderStat": "D", "searchType": 13, "fiscalYearEnd": "all"}
    if market:
        params["marketType"] = {"KOSPI": "stockMkt", "KOSDAQ": "kosdaqMkt"}[market]
    res = s.get(url, params=params, timeout=TIMEOUT)
    res.raise_for_status()
    res.encoding = "euc-kr"
    soup = BeautifulSoup(res.text, "lxml")

    out = []
    for tr in soup.select("tr")[1:]:
        td = [c.get_text(" ", strip=True) for c in tr.select("td")]
        if len(td) < 2:
            continue
        name, code = nfc(td[0]), re.sub(r"\D", "", td[1])
        if name and len(code) == 6:
            out.append({"name": name, "code": code})
    return out


# ---------------------------------------------------------------------------
# 회사 → 사업보고서 → 감사의견 절
# ---------------------------------------------------------------------------

def corp_code(s: requests.Session, name: str) -> str | None:
    for attempt in range(3):
        res = s.get(f"{BASE}/dsae001/search.ax",
                    params={"currentPage": 1, "maxResults": 15, "textCrpNm": name},
                    timeout=TIMEOUT)
        res.raise_for_status()
        codes = re.findall(r"select\('(\d{8})'\)", res.text)
        if codes:
            return codes[0]
        time.sleep(1 + attempt)
    return None


def latest_annual(s: requests.Session, code: str) -> str | None:
    """가장 최근 사업보고서의 접수번호. 정정본이 있으면 그쪽을 쓴다."""
    today = date.today()
    res = s.get(f"{BASE}/dsab007/detailSearch.ax",
                params={"currentPage": 1, "maxResults": 100, "textCrpCik": code,
                        "startDate": today.replace(year=today.year - 2).strftime("%Y%m%d"),
                        "endDate": today.strftime("%Y%m%d")},
                timeout=TIMEOUT)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "lxml")
    for a in soup.select('a[href*="rcpNo="]'):
        title = re.sub(r"\s+", " ", a.get_text(" ", strip=True))
        if "사업보고서" not in title or "감사보고서" in title:
            continue
        m = re.search(r"rcpNo=(\d+)", a["href"])
        if m:
            return m.group(1)
    return None


# 절 이름은 로마숫자가 붙는데 보고서마다 번호가 다르다(IV/V/VI).
_SEC = re.compile(
    r"node1\['text'\]\s*=\s*\"[IVX]+\.\s*회계감사인의[^\"]*\";(.{0,400}?)"
    r"node1\['length'\]\s*=\s*\"(\d+)\";", re.S)


def audit_section(s: requests.Session, rcp: str) -> str | None:
    """'회계감사인의 감사의견 등' 절의 본문. 보고서 전체를 받지 않는다."""
    res = s.get(f"{BASE}/dsaf001/main.do", params={"rcpNo": rcp}, timeout=TIMEOUT)
    res.raise_for_status()
    m = _SEC.search(res.text)
    if not m:
        return None
    blk = m.group(0)

    def field(k):
        f = re.search(rf"\['{k}'\]\s*=\s*\"([^\"]+)\"", blk)
        return f.group(1) if f else None

    p = {k: field(k) for k in ("rcpNo", "dcmNo", "eleId", "offset", "length")}
    if not all(p.values()):
        return None
    p["dtd"] = "dart4.xsd"
    r2 = s.get(f"{BASE}/report/viewer.do", params=p, timeout=TIMEOUT)
    r2.raise_for_status()
    return BeautifulSoup(r2.text, "lxml").get_text("\n")


# 회계법인 이름. '삼정회계법인', '회계법인 세일원', '(유)정일회계법인' 이 다 나온다.
_FIRM = re.compile(r"(?:\(유\)|\(주\))?\s*(?:회계법인\s*[가-힣A-Za-z]{2,10}"
                   r"|[가-힣A-Za-z]{2,12}\s*회계법인)")


def canonical(raw: str) -> str:
    name = re.sub(r"^\((?:유|주|합|유한)\)\s*", "", nfc(raw).strip())
    name = re.sub(r"\s+", "", name)
    m = re.match(r"^회계법인(.+)$", name)
    return f"{m.group(1)}회계법인" if m else name


def parse_auditor(text: str) -> dict | None:
    """당기 감사인과 감사의견.

    표가 '사업연도 / 구분 / 감사인 / 감사의견' 으로 되어 있고 당기가 맨
    위에 온다. 표 앞에 '삼정회계법인은 당사의 제55기 …' 하는 문장이
    먼저 나오는 경우가 많아 그쪽을 먼저 본다.
    """
    head = text.find("회계감사인의 명칭 및 감사의견")
    seg = text[max(0, head - 600): head + 1200] if head >= 0 else text[:2000]

    names = [canonical(m.group(0)) for m in _FIRM.finditer(seg)]
    if not names:
        return None
    # 가장 많이 나온 이름을 쓴다. 3개년이 실려 있어 당기 감사인이 최소
    # 두 번(별도·연결) 나오는 반면 전기 감사인은 바뀌었을 때만 나온다.
    best = max(set(names), key=names.count)
    op = re.search(r"(적정의견|한정의견|부적정의견|의견거절)", seg)
    return {"auditor": best, "opinion": op.group(1) if op else ""}


def collect(targets: list[dict], verbose: bool = True) -> list[dict]:
    s = session()
    out = []
    for i, c in enumerate(targets, 1):
        row = {"회사명": c["name"], "종목코드": c["code"], "감사인": "", "감사의견": "", "비고": ""}
        try:
            code = corp_code(s, c["name"])
            if not code:
                row["비고"] = "DART 에서 회사를 못 찾음"
            else:
                rcp = latest_annual(s, code)
                if not rcp:
                    row["비고"] = "최근 2년 사업보고서 없음"
                else:
                    sec = audit_section(s, rcp)
                    if not sec:
                        row["비고"] = "감사의견 절을 못 찾음"
                    else:
                        got = parse_auditor(sec)
                        if not got:
                            row["비고"] = "감사인 이름을 못 읽음"
                        else:
                            row.update({"감사인": got["auditor"], "감사의견": got["opinion"]})
        except Exception as exc:
            row["비고"] = f"{type(exc).__name__}: {exc}"[:60]
        out.append(row)
        if verbose:
            mark = "✅" if row["감사인"] else "❌"
            print(f"  {i:>4}/{len(targets)} {mark} {c['name'][:18]:<20}"
                  f"{row['감사인'] or row['비고']}")
        time.sleep(DELAY)
    return out


def write_csv(rows: list[dict]) -> Path:
    DATA.mkdir(exist_ok=True)
    path = DATA / "상장사_감사인.csv"
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["회사명", "종목코드", "감사인", "감사의견", "비고"])
        w.writeheader()
        w.writerows(rows)
    return path


def summarize(rows: list[dict]) -> None:
    ok = [r for r in rows if r["감사인"]]
    print(f"\n감사인 확인 {len(ok)} / {len(rows)}곳 ({len(ok) * 100 // max(1, len(rows))}%)")
    if not ok:
        return
    by = defaultdict(list)
    for r in ok:
        by[r["감사인"]].append(r["회사명"])
    print(f"회계법인 {len(by)}곳\n")
    for name, cos in sorted(by.items(), key=lambda x: -len(x[1]))[:15]:
        print(f"  {name:<16}{len(cos):>4}곳   {', '.join(cos[:3])}"
              f"{' …' if len(cos) > 3 else ''}")
    bad = defaultdict(int)
    for r in rows:
        if not r["감사인"]:
            bad[r["비고"][:24]] += 1
    if bad:
        print("\n못 읽은 사유")
        for k, v in sorted(bad.items(), key=lambda x: -x[1]):
            print(f"  {v:>4}건  {k}")


def main() -> int:
    ap = argparse.ArgumentParser(description="상장사 외부감사인 수집")
    ap.add_argument("--limit", type=int, default=100, help="시험 삼아 몇 곳만 (기본 100)")
    ap.add_argument("--all", action="store_true", help="상장사 전부")
    ap.add_argument("--market", choices=["KOSPI", "KOSDAQ"], help="시장 한정")
    ap.add_argument("--write", action="store_true", help="CSV 로 저장")
    args = ap.parse_args()

    s = session()
    companies = listed_companies(s, args.market)
    print(f"상장사 {len(companies)}곳"
          + (f" ({args.market})" if args.market else ""))
    if not companies:
        print("❌ 상장사 목록을 받지 못했습니다.")
        return 1

    targets = companies if args.all else companies[: args.limit]
    print(f"대상 {len(targets)}곳\n")

    rows = collect(targets)
    summarize(rows)
    if args.write:
        print(f"\n→ {write_csv(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
