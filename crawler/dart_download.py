"""DART 에서 회계법인 사업보고서를 받아 source/<법인명>/ 에 저장한다.

    python crawler/dart_download.py                 자료 없는 법인 전부
    python crawler/dart_download.py 동성회계법인      한 곳만
    python crawler/dart_download.py --years 6        최근 6개년 (기본 5)

OpenDART API 키가 필요 없다. DART 웹이 그대로 응답한다.

  ① 회사명 → 회사코드   dsae001/search.ax
  ② 회사코드 → 공시목록  dsab007/detailSearch.ax
  ③ 공시 → 문서번호     dsaf001/main.do
  ④ 문서번호 → PDF     pdf/download/pdf.do

같은 연도에 정정본이 있으면 정정본만 받는다. 원본은 이미 틀린 값이다.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
import unicodedata
from datetime import date
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://dart.fss.or.kr"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
DELAY = 1.0          # 상대 서버 배려
TIMEOUT = 40

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "source"


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Referer": BASE})
    return s


def find_corp_codes(s: requests.Session, name: str) -> list[str]:
    """회사명으로 DART 회사코드를 찾는다.

    같은 이름으로 코드가 여러 개인 경우가 있다(법인 전환·재등록 등).
    선일회계법인이 그렇다. 전부 돌려주고 공시가 있는 쪽을 고른다.

    이름을 다는 방식이 두 가지다. '세일원회계법인' 이 아니라
    **'회계법인세일원'** 으로 등록된 곳이 있어서 접미사형으로만 찾으면
    "회사를 못 찾음" 이 된다. 둘 다 시도한다.
    """
    stem = re.sub(r"회계법인", "", name).strip()
    variants = [name]
    for v in (f"{stem}회계법인", f"회계법인{stem}", stem):
        if v and v not in variants:
            variants.append(v)

    for variant in variants:
        # 요청이 몰리면 DART 가 잠시 빈 응답을 준다. 몇 초 쉬고 다시 묻는다.
        for attempt in range(3):
            res = s.get(f"{BASE}/dsae001/search.ax",
                        params={"currentPage": 1, "maxResults": 15,
                                "textCrpNm": variant},
                        timeout=TIMEOUT)
            res.raise_for_status()
            codes = re.findall(r"select\('(\d{8})'\)", res.text)
            if codes:
                if variant != name:
                    print(f"   (DART 등록명 '{variant}')")
                return codes
            time.sleep(2 + attempt * 2)
    return []


def list_reports(s: requests.Session, corp_code: str) -> list[dict]:
    """회계법인사업보고서 목록. 같은 연도는 정정본을 남긴다."""
    # DART 는 조회 기간이 10년을 넘거나 종료일이 미래면 **오류 없이 빈 결과**를
    # 준다. 잘못 주면 "공시가 없다" 로 보여 원인을 찾기 어렵다.
    today = date.today()
    start = today.replace(year=today.year - 9).strftime("%Y%m%d")
    res = s.get(f"{BASE}/dsab007/detailSearch.ax",
                params={"currentPage": 1, "maxResults": 100,
                        "textCrpCik": corp_code,
                        "startDate": start,
                        "endDate": today.strftime("%Y%m%d")},
                timeout=TIMEOUT)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "lxml")

    found: dict[str, dict] = {}
    for tr in soup.select("table tbody tr"):
        a = tr.select_one('a[href*="rcpNo="]')
        if not a:
            continue
        title = re.sub(r"\s+", " ", a.get_text(" ", strip=True))
        if "회계법인사업보고서" not in title:
            continue
        year = re.search(r"\((\d{4}\.\d{2})\)", title)
        rcp = re.search(r"rcpNo=(\d+)", a["href"])
        if not (year and rcp):
            continue
        key = year.group(1)
        amended = "정정" in title
        # 정정본이 우선. 같은 종류면 접수번호가 큰 쪽(더 나중)을 쓴다.
        prev = found.get(key)
        if prev and (prev["amended"] and not amended):
            continue
        if prev and prev["amended"] == amended and prev["rcp"] >= rcp.group(1):
            continue
        found[key] = {"year": key, "rcp": rcp.group(1),
                      "amended": amended, "title": title}

    return sorted(found.values(), key=lambda r: r["year"], reverse=True)


def download(s: requests.Session, report: dict, dest: Path, firm: str) -> str:
    """PDF 를 받아 저장한다. 이미 있으면 건너뛴다."""
    mark = "[정정]" if report["amended"] else ""
    # DART 화면의 파일명 규칙을 따른다 (직접 받으신 파일과 같은 형태)
    name = f"[{firm}]{mark}회계법인사업보고서({report['year']}).pdf"
    path = dest / name
    if path.exists():
        return f"건너뜀 (이미 있음) {name}"

    viewer = s.get(f"{BASE}/dsaf001/main.do", params={"rcpNo": report["rcp"]},
                   timeout=TIMEOUT)
    viewer.raise_for_status()
    dcm = re.search(r"dcmNo'?\]?\s*=\s*[\"'](\d+)[\"']", viewer.text)
    if not dcm:
        return f"❌ 문서번호를 못 찾음 {name}"

    # 다운로드 페이지를 먼저 거쳐야 pdf.do 가 파일을 준다.
    # 건너뛰면 200 을 주면서 빈 응답이 온다.
    time.sleep(DELAY)
    gate = f"{BASE}/pdf/download/main.do?rcp_no={report['rcp']}&dcm_no={dcm.group(1)}"
    s.get(gate, params={"lang": "ko"}, timeout=TIMEOUT)

    time.sleep(DELAY)
    pdf = s.get(f"{BASE}/pdf/download/pdf.do",
                params={"rcp_no": report["rcp"], "dcm_no": dcm.group(1), "lang": "ko"},
                headers={"Referer": gate}, timeout=TIMEOUT)
    if not pdf.ok or not pdf.content.startswith(b"%PDF"):
        head = pdf.content[:60].decode("utf-8", "replace").strip()
        return f"❌ 내려받기 실패 ({pdf.status_code}, {len(pdf.content)}B: {head[:40]}) {name}"

    path.write_bytes(pdf.content)
    return f"✅ {name}  {len(pdf.content) // 1024}KB"


def nfc(name: str) -> str:
    """macOS 파일시스템은 한글을 자모로 분해해 저장한다(NFD).

    '동성' 이 'ㄷㅗㅇㅅㅓㅇ' 으로 들어와 눈에는 같아 보이지만 DART 검색이
    실패한다. 폴더명을 읽을 때마다 합쳐진 형태로 되돌린다.
    """
    return unicodedata.normalize("NFC", name)


def firms_without_data() -> list[str]:
    """CSV 가 없는 폴더 = 아직 정리되지 않은 법인."""
    if not SOURCE.exists():
        return []
    return sorted(nfc(d.name) for d in SOURCE.iterdir()
                  if d.is_dir() and not list(d.glob("*.csv")))


def main() -> int:
    ap = argparse.ArgumentParser(description="DART 사업보고서 수집")
    ap.add_argument("firms", nargs="*", help="법인명 (없으면 CSV 없는 폴더 전부)")
    ap.add_argument("--years", type=int, default=5, help="최근 몇 개년 (기본 5)")
    args = ap.parse_args()

    targets = [nfc(f) for f in args.firms] or firms_without_data()
    if not targets:
        print("받을 법인이 없습니다.")
        return 0

    print(f"대상 {len(targets)}곳 · 최근 {args.years}개년\n")
    s = session()

    for firm in targets:
        dest = SOURCE / firm
        dest.mkdir(parents=True, exist_ok=True)
        print(f"── {firm}")
        try:
            time.sleep(DELAY)
            codes = find_corp_codes(s, firm)
            if not codes:
                print("   ❌ DART 에서 회사를 못 찾음\n")
                continue

            # 코드가 여럿이면 공시가 가장 많은 것을 쓴다
            best_code, reports = None, []
            for c in codes[:3]:
                time.sleep(DELAY)
                found = list_reports(s, c)
                if len(found) > len(reports):
                    best_code, reports = c, found
            if not reports:
                print(f"   ❌ 사업보고서 공시가 없음 (코드 {', '.join(codes)})\n")
                continue

            reports = reports[: args.years]
            print(f"   코드 {best_code} · 보고서 {len(reports)}건")

            for r in reports:
                time.sleep(DELAY)
                print("   " + download(s, r, dest, firm))
        except requests.RequestException as exc:
            print(f"   ❌ 통신 오류: {exc}")
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
