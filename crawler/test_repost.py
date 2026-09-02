"""끌올 판정 테스트. 실제 공고 제목을 표본으로 쓴다.

    python crawler/test_repost.py
"""

import unittest
from types import SimpleNamespace

import repost as R


def posting(company, title, ij_id="new", posted=None, region=""):
    return SimpleNamespace(company_name=company, title=title, ij_id=ij_id,
                           posted_at=posted, work_region=region)


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


class 같은날_다른자리(unittest.TestCase):
    """서현회계법인 서울 본점과 광주지점이 같은 날 각각 올린 공고.

    제목 앞머리 괄호에만 지점이 적혀 있고 회사명 칸에는 없다. 괄호를 떼면
    나머지가 한 글자도 다르지 않아 유사도가 1.0 이 나온다.
    """

    서울 = "[PKF서현회계법인] 2026 신입 공인회계사 채용(정규직, 파트타임)"
    광주 = "[PKF서현회계법인_광주지점] 2026 신입 공인회계사 채용(정규직, 파트타임)"

    def test_지점이_다르면_끌올이_아니다(self):
        p = posting("서현회계법인", self.광주, posted="2026-09-02", region="광주 서구")
        prev = old("서현회계법인", self.서울, posted="2026-09-02", work_region="서울 강남구")
        self.assertIsNone(R.find_original(p, [prev]))

    def test_같은_날_올라온_둘은_끌올이_아니다(self):
        # 지점 표기가 없어도 같은 날이면 다시 올린 게 아니다
        p = posting("가나회계법인", "수습회계사 모집", posted="2026-09-02")
        prev = old("가나회계법인", "수습회계사 모집", posted="2026-09-02")
        self.assertIsNone(R.find_original(p, [prev]))

    def test_지역이_다르면_끌올이_아니다(self):
        p = posting("가나회계법인", "수습회계사 모집", posted="2026-09-10", region="부산")
        prev = old("가나회계법인", "수습회계사 모집", posted="2026-08-03", work_region="서울")
        self.assertIsNone(R.find_original(p, [prev]))

    def test_날짜와_지역이_같으면_여전히_끌올이다(self):
        p = posting("가나회계법인", "수습회계사 모집", posted="2026-09-10", region="서울")
        prev = old("가나회계법인", "수습회계사 모집", posted="2026-08-03", work_region="서울")
        self.assertIsNotNone(R.find_original(p, [prev]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
