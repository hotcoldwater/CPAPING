"""불완전한 한공회 목록이 공고 삭제·알림으로 이어지지 않도록 검증한다."""
import unittest
from unittest.mock import Mock, patch

import kicpa
import main


def rows(*ids):
    return [kicpa.Posting(ij_id=str(i)) for i in ids]


class CompleteListTest(unittest.TestCase):
    def fetch(self, pages, **kwargs):
        with patch.object(kicpa, "fetch_list", side_effect=pages) as fetch:
            result = kicpa.fetch_complete_list(Mock(), delay=0, **kwargs)
            return result, fetch.call_args_list

    def test_여러_페이지의_고유_ID를_전부_수집(self):
        (items, total), calls = self.fetch(
            [(rows(1, 2), 5), (rows(3, 4), 5), (rows(5), 5)], list_cnt=2, board="cpa")
        self.assertEqual([p.ij_id for p in items], ["1", "2", "3", "4", "5"])
        self.assertEqual(total, 5)
        self.assertEqual([c.kwargs["page"] for c in calls], [1, 2, 3])
        self.assertTrue(all(c.kwargs["board"] == "cpa" for c in calls))

    def test_서버가_요청보다_작은_페이지를_줘도_총건수까지_진행(self):
        (items, _), calls = self.fetch([(rows(1), 2), (rows(2), 2)], list_cnt=100)
        self.assertEqual(len(items), 2)
        self.assertEqual(len(calls), 2)

    def test_마지막_페이지가_꽉_차도_불필요한_요청_없음(self):
        (_, total), calls = self.fetch([(rows(1, 2), 2)], list_cnt=2)
        self.assertEqual(total, 2)
        self.assertEqual(len(calls), 1)

    def test_잘못된_목록은_부분_결과를_반환하지_않음(self):
        cases = [
            [(rows(1), None)],                      # 전체 건수 파싱 실패
            [(rows(1), 3), ([], 3)],                # 중간 빈 페이지
            [(rows(1), 2), (rows(1), 2)],           # 페이지 번호 무시/중복
            [(rows(1, 1), 2)],                     # 한 페이지 내 중복
            [(rows(""), 1)],                       # 식별자 파싱 실패
            [(rows(1), 2), (rows(2), 3)],           # 조회 도중 게시판 변경
            [(rows(1, 2), 1)],                     # 총 건수보다 많은 결과
        ]
        for pages in cases:
            with self.subTest(pages=pages), self.assertRaises(RuntimeError):
                self.fetch(pages)

    def test_페이지_상한에_도달하면_실패(self):
        with self.assertRaisesRegex(RuntimeError, "최대"):
            self.fetch([(rows(1), 2)], max_pages=1)

    def test_정상_0건은_전체목록_함수에서_구별(self):
        (items, total), _ = self.fetch([([], 0)])
        self.assertEqual((items, total), ([], 0))

    def test_요청_실패를_숨기지_않음(self):
        with patch.object(kicpa, "fetch_list", side_effect=kicpa.requests.RequestException("HTTP 실패")):
            with self.assertRaises(kicpa.requests.RequestException):
                kicpa.fetch_complete_list(Mock())

    def test_목록_검증_실패시_DB와_메일에_접근하지_않음(self):
        with patch.object(kicpa, "make_session"), \
             patch.object(kicpa, "fetch_complete_list", side_effect=RuntimeError("불완전한 목록")), \
             patch.object(main.store, "Store") as db, \
             patch.object(main.notify, "send_new_postings") as mail:
            with self.assertRaises(RuntimeError):
                main.crawl()
            db.assert_not_called()
            mail.assert_not_called()

    def test_목록이_갑자기_0건이면_기존_공고를_모두_내리지_않음(self):
        with patch.object(kicpa, "make_session"), \
             patch.object(kicpa, "fetch_complete_list", return_value=([], 0)), \
             patch.object(main.store, "Store") as db:
            with self.assertRaises(RuntimeError):
                main.crawl()
            db.assert_not_called()


if __name__ == "__main__":
    unittest.main()
