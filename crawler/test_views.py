"""한공회 조회수 이력 행 만들기 — 조회수 없는 공고는 빼고, 같은 공고는 마지막 값."""
from __future__ import annotations

import unittest
from datetime import date
from types import SimpleNamespace as P

from store import view_snapshot_rows


class ViewSnapshotRows(unittest.TestCase):
    def test_skips_missing_and_dedupes(self):
        rows = view_snapshot_rows(
            [P(ij_id="1", view_count=10), P(ij_id="2", view_count=None), P(ij_id="", view_count=5), P(ij_id="1", view_count=12)],
            date(2026, 9, 10),
        )
        self.assertEqual(rows, [{"ij_id": "1", "day": "2026-09-10", "view_count": 12}])

    def test_empty(self):
        self.assertEqual(view_snapshot_rows([], date(2026, 9, 10)), [])


if __name__ == "__main__":
    unittest.main()
