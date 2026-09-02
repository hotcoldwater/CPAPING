"""사람이 조사한 법인 자료를 DB 에 넣는다.

    python crawler/import_firm_data.py data/새빛회계법인_5개년_정리.csv
    python crawler/import_firm_data.py data/주권상장법인_감사인_등록법인_40개.csv

두 가지 CSV 를 알아본다.

**재무 시계열** — 법인명·기준연도·매출 등이 있는 파일. 연도별로 쌓는다.
**감사인 등록 목록** — 회계법인명·등록번호·등록일. 등록 여부만 표시한다.

크롤러가 소유한 컬럼(공고 이력 등)은 건드리지 않는다.
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

import firms as firmlib
import store


def num(v):
    """'138.96' → 138.96, 빈 값은 None. 쉼표와 단위를 걷어낸다."""
    if v is None:
        return None
    s = re.sub(r"[^\d.\-]", "", str(v).strip())
    return float(s) if s else None


def integer(v):
    n = num(v)
    return int(n) if n is not None else None


def find_firm(db, name: str, create: bool = False) -> dict | None:
    """이름이나 별칭으로 법인을 찾는다. 없으면 create 일 때 만든다.

    처음에는 공고를 낸 법인만 들어 있었지만, 이제 사업보고서를 낸 회계법인
    전부를 싣는다. 공고가 없는 법인은 여기서 처음 만들어진다. 크롤러가
    쓰는 컬럼(공고 이력 등)은 비워 두면 되고, 나중에 그 법인이 공고를
    올리면 크롤러가 같은 이름으로 찾아 자기 컬럼만 채운다.
    """
    canonical = firmlib.canonical_name(name)
    rows = db._request("GET", "firms",
                       params={"select": "id,name", "name": f"eq.{canonical}"})
    if rows:
        return rows[0]
    if not create:
        return None
    made = db._request(
        "POST", "firms",
        headers={"Prefer": "return=representation"},
        json={"name": canonical, "slug": firmlib.slugify(canonical), "aliases": []},
    )
    return made[0] if made else None


def import_financials(db, path: Path) -> None:
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
    if not rows:
        print("빈 파일입니다."); return

    name = rows[0]["법인명"]
    firm = find_firm(db, name, create=True)
    if not firm:
        print(f"❌ '{name}' 법인 행을 만들지 못했습니다.")
        return

    # 법인 단위 정보 — 가장 최근 연도 행에서 가져온다
    last = rows[-1]
    note = last.get("비고") or ""

    # 등록번호와 등록일이 비고에 묻혀 있는 경우가 있다.
    # "주권상장법인 감사인 2019-11-25 등록(회계법인 등록번호 제159호)"
    reg_date = re.search(r"감사인\s*(\d{4}-\d{2}-\d{2})\s*등록", note)
    reg_no = re.search(r"등록번호\s*(제\s*\d+\s*호)", note)

    profile = {
        "auditor_reg_no": reg_no.group(1).replace(" ", "") if reg_no else None,
        "auditor_reg_date": reg_date.group(1) if reg_date else None,
        "ceo": last.get("현재대표이사") or None,
        "address": last.get("본사소재지") or None,
        "is_listed_auditor": (last.get("상장감사인등록") or "").strip().upper() == "O",
        "data_source": "회계법인 사업보고서",
        "note": note or None,
        "manual_updated_at": "now()",
    }
    profile = {k: v for k, v in profile.items() if v is not None}
    db._request("PATCH", "firms", params={"id": f"eq.{firm['id']}"},
                headers={"Prefer": "return=minimal"}, json=profile)

    # 연도별 재무·인력
    financials = [{
        "firm_id": firm["id"],
        "fiscal_year": r["기준연도"].strip(),
        "revenue": num(r.get("매출액_억원")),
        "revenue_audit": num(r.get("감사매출_억원")),
        "revenue_tax": num(r.get("세무매출_억원")),
        "revenue_deal": num(r.get("딜자문매출_억원")),
        "revenue_other": num(r.get("기타매출_억원")),
        "cpa_count": integer(r.get("회계사수")),
        "trainee_count": integer(r.get("수습CPA수")),
        "partner_count": integer(r.get("파트너수")),
    } for r in rows]

    db._request("POST", "firm_financials",
                params={"on_conflict": "firm_id,fiscal_year"},
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                json=financials)

    print(f"✅ {firm['name']} — 프로필 갱신, 재무 {len(financials)}개 연도")
    for r in rows:
        print(f"     {r['기준연도']}  매출 {r['매출액_억원']:>7}억  "
              f"회계사 {r['회계사수']:>2}명  수습 {r['수습CPA수']}명")


def import_registered_auditors(db, path: Path) -> None:
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
    known = {r["name"]: r["id"] for r in
             db._request("GET", "firms", params={"select": "id,name"})}

    matched, unmatched = [], []
    for r in rows:
        # 목록에는 '한영', '대주' 처럼 짧게 적혀 있다
        short = r["회계법인명"].strip()
        full = next((n for n in known if n.startswith(short)), None)
        if not full:
            unmatched.append(short); continue
        matched.append({
            "id": known[full], "name": full,
            "reg_no": r.get("회계법인 등록번호", "").strip(),
            "reg_date": r.get("주권상장법인 감사인 등록일", "").strip(),
        })

    for m in matched:
        db._request("PATCH", "firms", params={"id": f"eq.{m['id']}"},
                    headers={"Prefer": "return=minimal"},
                    json={"is_listed_auditor": True,
                          "auditor_reg_no": m["reg_no"] or None,
                          "auditor_reg_date": m["reg_date"] or None,
                          "manual_updated_at": "now()"})

    print(f"✅ 등록 법인 {len(rows)}곳 중 우리 DB 와 일치 {len(matched)}곳")
    for m in matched:
        print(f"     {m['name']}  {m['reg_no']}  {m['reg_date']}")
    print(f"   (아직 공고를 낸 적 없어 건너뜀: {len(unmatched)}곳)")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__); return 1
    load_dotenv()
    db = store.Store()
    path = Path(sys.argv[1])
    header = path.open(encoding="utf-8-sig").readline()

    if "기준연도" in header:
        import_financials(db, path)
    elif "회계법인명" in header:
        import_registered_auditors(db, path)
    else:
        print(f"알 수 없는 형식입니다: {header[:60]}"); return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
