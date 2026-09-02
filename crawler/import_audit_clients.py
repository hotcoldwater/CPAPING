"""상장사 감사인 CSV 를 audit_clients 에 넣는다.

    python crawler/import_audit_clients.py

data/상장사_감사인.csv 는 dart_auditors.py 가 만든다. 감사인을 못 읽은
줄은 넣지 않는다 — 빈 줄을 넣으면 "고객이 없다" 와 "아직 못 읽었다" 를
구분할 수 없다.
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

import store

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "상장사_감사인.csv"
CHUNK = 500

SPAC = re.compile(r"스팩|기업인수목적")

# 개명한 회계법인.
#
# 감사인 이름은 **상장사가 낸 보고서**에서 읽는다. 그 보고서를 낼 당시의
# 이름이라 지금 이름과 다를 수 있다. 우리 firms 는 회계법인 사업보고서의
# 최신 이름을 쓰므로 여기서 맞춰 준다. 안 맞추면 그 법인의 고객 목록이
# 화면에 안 붙는다.
RENAMED = {
    "대성삼경회계법인": "대성회계법인",
    "동아송강회계법인": "동성회계법인",
    "진일회계법인": "태일회계법인",
    "EY한영회계법인": "한영회계법인",
    "예교지성회계법인": "예지회계법인",
    "성도이현회계법인": "성현회계법인",
    "영앤진회계법인": "동현회계법인",
}


def main() -> int:
    load_dotenv(ROOT / ".env")
    if not CSV_PATH.exists():
        print(f"❌ {CSV_PATH} 가 없습니다. dart_auditors.py 를 먼저 돌리세요.")
        return 1

    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8-sig")))

    # KIND 목록은 상장 **종목** 단위라 보통주와 우선주가 따로 실린 회사가
    # 같은 이름으로 두 번 들어온다(32곳). 감사인은 회사 하나에 하나이므로
    # 회사 단위로 합친다. 그러지 않으면 (법인, 회사) 유일 제약에 걸린다.
    seen: set[tuple[str, str]] = set()
    uniq = []
    for r in rows:
        raw = r.get("감사인", "").strip()
        key = (RENAMED.get(raw, raw), r.get("회사명", "").strip())
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)
    if len(uniq) != len(rows):
        print(f"   같은 회사가 두 번 실린 줄 {len(rows) - len(uniq)}건을 합쳤습니다")
    rows = uniq

    payload = [{
        "firm_name": RENAMED.get(r["감사인"].strip(), r["감사인"].strip()),
        "company": r["회사명"].strip(),
        "stock_code": (r.get("종목코드") or "").strip() or None,
        "market": (r.get("시장") or "").strip() or None,
        "opinion": (r.get("감사의견") or "").strip() or None,
        "is_spac": bool(SPAC.search(r["회사명"])),
        "fiscal_note": "최근 사업보고서",
    } for r in rows if r.get("감사인", "").strip()]

    if not payload:
        print("❌ 감사인이 채워진 줄이 없습니다.")
        return 1

    db = store.Store()
    # 같은 (회계법인, 회사) 는 덮어쓴다. 감사인은 해마다 바뀐다.
    for i in range(0, len(payload), CHUNK):
        db._request(
            "POST", "audit_clients",
            params={"on_conflict": "firm_name,company"},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=payload[i:i + CHUNK],
        )
        print(f"   {min(i + CHUNK, len(payload))} / {len(payload)}")

    firms = {}
    for p in payload:
        firms.setdefault(p["firm_name"], 0)
        firms[p["firm_name"]] += 1
    print(f"\n✅ {len(payload)}건 · 회계법인 {len(firms)}곳")
    for name, n in sorted(firms.items(), key=lambda x: -x[1])[:10]:
        print(f"   {name:<16}{n:>5}곳")

    # 우리 firms 에 없는 회계법인은 화면에 못 붙는다. 몇 곳인지 알려준다.
    known = {f["name"] for f in db._request(
        "GET", "firms", params={"select": "name", "limit": "1000"})}
    orphan = {k: v for k, v in firms.items() if k not in known}
    if orphan:
        print(f"\n⚠️  firms 에 없는 회계법인 {len(orphan)}곳 "
              f"(감사 고객 {sum(orphan.values())}곳) — 법인 페이지가 없어 안 보입니다")
        for name, n in sorted(orphan.items(), key=lambda x: -x[1])[:10]:
            print(f"   {name:<16}{n:>5}곳")
    return 0


if __name__ == "__main__":
    sys.exit(main())
