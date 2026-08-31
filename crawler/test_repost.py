"""끌올 판정 테스트. 실제 공고 제목을 표본으로 쓴다.

    python crawler/test_repost.py
"""

import unittest
from types import SimpleNamespace

import repost as R


def posting(company, title, ij_id="new"):
    return SimpleNamespace(company_name=company, title=title, ij_id=ij_id)


def old(company, title, id=1, posted="2026-08-03", **kw):
    return {"id": id, "ij_id": f"old{id}", "company_name": company,
            "title": title, "posted_at": posted, **kw}


class NormalizeTest(unittest.TestCase):
    def test_제목_앞의_법인명은_비교에서_뺀다(self):
        a = R.normalize_title("[동성회계법인] 수습 회계사 채용")
        b = R.normalize_title("수습회계사 채용")
        self.assertGreaterEqual(R.title_similarity(a, b), R.SIMILARITY_THRESHOLD)

    def test_공백과_문장부호_차이는_무시한다(self):
        self.assertEqual(
            R.normalize_title("수습 회계사 모집 (계약직)"),
            R.normalize_title("수습회계사모집계약직"),
        )

    def test_지점이_다르면_다른_법인으로_본다(self):
        self.assertNotEqual(
            R.normalize_company("삼원회계법인(성서지점)"),
            R.normalize_company("삼원회계법인"),
        )


class FindOriginalTest(unittest.TestCase):
    def test_같은_법인의_같은_자리를_찾는다(self):
        found = R.find_original(
            posting("동성회계법인", "[동성회계법인] 수습 회계사 채용"),
            [old("동성회계법인", "동성회계법인 수습회계사 채용", id=7)],
        )
        self.assertIsNotNone(found)
        self.assertEqual(found["id"], 7)

    def test_법인이_다르면_찾지_않는다(self):
        self.assertIsNone(R.find_original(
            posting("세영회계법인", "수습회계사 모집"),
            [old("신화회계법인", "수습회계사 모집")],
        ))

    def test_같은_법인이라도_자리가_다르면_찾지_않는다(self):
        # 본부가 다르면 새로 열린 자리다. 끌올로 부르면 새 기회를 놓친다.
        self.assertIsNone(R.find_original(
            posting("회계법인 베율", "4본부(TAX) 공인회계사 채용"),
            [old("회계법인 베율", "2본부 공인회계사 채용")],
        ))

    def test_연도가_다르면_다른_채용으로_본다(self):
        self.assertIsNone(R.find_original(
            posting("성현회계법인", "BDO성현회계법인 2027 신입 공인회계사 공채"),
            [old("성현회계법인", "BDO성현회계법인 2026 신입 공인회계사 공채")],
        ))

    def test_여러_개가_걸리면_가장_오래된_것을_고른다(self):
        found = R.find_original(
            posting("정일회계법인", "수습 공인회계사 채용"),
            [
                old("정일회계법인", "수습 공인회계사 채용", id=20, posted="2026-08-12"),
                old("정일회계법인", "수습 공인회계사 채용", id=5, posted="2026-06-01"),
            ],
        )
        self.assertEqual(found["id"], 5)

    def test_자기_자신은_후보에서_뺀다(self):
        self.assertIsNone(R.find_original(
            posting("세영회계법인", "수습회계사 모집", ij_id="same"),
            [{"id": 1, "ij_id": "same", "company_name": "세영회계법인",
              "title": "수습회계사 모집", "posted_at": "2026-08-24"}],
        ))


class RepostFieldsTest(unittest.TestCase):
    def test_최초_공고는_빈_값(self):
        f = R.repost_fields(posting("새빛회계법인", "2026년 신입 공인회계사 모집"), [])
        self.assertEqual(f, {"original_id": None, "original_posted_at": None, "repost_count": 0})

    def test_첫_끌올(self):
        f = R.repost_fields(
            posting("정일회계법인", "수습 공인회계사 채용"),
            [old("정일회계법인", "수습 공인회계사 채용", id=5, posted="2026-06-01")],
        )
        self.assertEqual(f["original_id"], 5)
        self.assertEqual(f["original_posted_at"], "2026-06-01")
        self.assertEqual(f["repost_count"], 1)

    def test_끌올의_끌올은_최초를_가리킨다(self):
        # 사슬이 아니라 항상 최초를 가리켜야 '최초 등록일' 이 흐려지지 않는다
        f = R.repost_fields(
            posting("정일회계법인", "수습 공인회계사 채용"),
            [old("정일회계법인", "수습 공인회계사 채용", id=20, posted="2026-07-05",
                 original_id=5, original_posted_at="2026-06-01", repost_count=1)],
        )
        self.assertEqual(f["original_id"], 5)
        self.assertEqual(f["original_posted_at"], "2026-06-01")
        self.assertEqual(f["repost_count"], 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
