"""분류기 테스트. 실제 한공회 공고 제목을 표본으로 쓴다.

    python crawler/test_classify.py
"""

import unittest
from datetime import date, timedelta
from types import SimpleNamespace

import classify as C


class Big4Test(unittest.TestCase):
    def test_빅4_법인을_찾는다(self):
        cases = {
            "삼일회계법인": "삼일",
            "PwC컨설팅": "삼일",          # 한글이 붙어도 잡혀야 한다
            "삼정KPMG": "삼정",
            "삼정회계법인": "삼정",
            "딜로이트 안진회계법인": "안진",
            "딜로이트 안진회게법인": "안진",  # 실제 공고의 오타
            "한영회계법인": "한영",
            "EY한영": "한영",
        }
        for name, expected in cases.items():
            with self.subTest(name):
                self.assertEqual(C.detect_big4(name), expected)

    def test_이름이_비슷한_로컬을_빅4로_보지_않는다(self):
        # 삼O회계법인이 많아 부분 문자열로 판정하면 전부 걸린다
        for name in ("삼성회계법인", "삼도회계법인", "삼율회계법인", "삼원회계법인",
                     "삼화회계법인", "삼지회계법인", "새빛회계법인", "성현회계법인",
                     "예지회계법인", "선일회계법인"):
            with self.subTest(name):
                self.assertIsNone(C.detect_big4(name))


class PostingTypeTest(unittest.TestCase):
    def test_수습CPA_게시판은_무조건_신입(self):
        ptype, _ = C.classify_posting_type(
            "[동성회계법인] 수습 회계사 채용", board="trainee"
        )
        self.assertEqual(ptype, C.TYPE_ENTRY)

    def test_신입_수습_공고(self):
        for title in ("[선진회계법인] 수습 공인회계사 모집공고",
                      "2026년 신입 공인회계사 모집",
                      "[회계법인 공명] 수습 및 경력회계사(5년 이하) 채용"):
            with self.subTest(title):
                self.assertEqual(C.classify_posting_type(title)[0], C.TYPE_ENTRY)

    def test_개업_파트너_공고는_따로_분류한다(self):
        for title in ("개업 회계사님을 모십니다 [영신회계법인]",
                      "[가현회계법인] 파트너 및 개업 회계사님을 모십니다.",
                      "개업/반개업 회계사님을 모십니다",
                      "세연회계법인에서 파트너 회계사님을 초빙합니다"):
            with self.subTest(title):
                self.assertEqual(C.classify_posting_type(title)[0], C.TYPE_PARTNER)

    def test_경력직_공고(self):
        for title in ("[인덕회계법인] 경력공인회계사 채용",
                      "[동성회계법인] 1~6년차 경력직 회계사님을 모십니다.",
                      "[효림회계법인] 경력 공인회계사 채용 (3~5년차)"):
            with self.subTest(title):
                self.assertEqual(C.classify_posting_type(title)[0], C.TYPE_EXPERIENCED)

    def test_단서가_없으면_판단불가(self):
        ptype, _ = C.classify_posting_type("[신한회계법인] 공인회계사 정규직 채용공고")
        self.assertEqual(ptype, C.TYPE_AMBIGUOUS)


class JobCategoryTest(unittest.TestCase):
    def test_제목에_있으면_신뢰도가_높다(self):
        cases = {
            "[경복회계법인] TAX 경력직 공인회계사 채용": C.JOB_TAX,
            "수습회계사 채용 - 국제조세부문": C.JOB_TAX,
            "[삼정KPMG] Deal Adv 2본부 M&A 재무실사": C.JOB_DEAL,
            "[PKF서현회계법인] 감사1본부 경력회계사 채용": C.JOB_AUDIT,
        }
        for title, expected in cases.items():
            with self.subTest(title):
                job, confidence, _ = C.classify_job_category(title)
                self.assertEqual(job, expected)
                self.assertEqual(confidence, "high")

    def test_법인_소개문에_낚이지_않는다(self):
        # 본문 전체를 훑으면 이런 소개문 때문에 전부 tax 가 된다.
        body = ("인덕회계법인은 주권상장법인 감사인 등록법인으로 회계감사, 세무와 "
                "경영컨설팅 등 다양한 업무를 제공하고 있습니다.\n"
                "3. 주요업무 분야 : M&A 자문")
        job, confidence, _ = C.classify_job_category("회계사 채용", body)
        self.assertEqual(job, C.JOB_DEAL)
        self.assertEqual(confidence, "medium")


class ExpiryTest(unittest.TestCase):
    def test_마감일이_지나면_만료(self):
        yesterday = date.today() - timedelta(days=1)
        self.assertTrue(C.is_expired(SimpleNamespace(deadline=yesterday, is_closed=False)))

    def test_구직완료면_만료(self):
        tomorrow = date.today() + timedelta(days=1)
        self.assertTrue(C.is_expired(SimpleNamespace(deadline=tomorrow, is_closed=True)))

    def test_마감일이_남아있으면_유효(self):
        tomorrow = date.today() + timedelta(days=1)
        self.assertFalse(C.is_expired(SimpleNamespace(deadline=tomorrow, is_closed=False)))


class TargetTest(unittest.TestCase):
    def _posting(self, **kw):
        base = dict(company_name="동성회계법인", title="[동성회계법인] 수습 회계사 채용",
                    career="", body="", board="trainee", is_closed=False,
                    deadline=date.today() + timedelta(days=7))
        base.update(kw)
        return SimpleNamespace(**base)

    def test_로컬_수습공고는_알림_대상(self):
        self.assertTrue(C.classify(self._posting())["is_target"])

    def test_빅4는_제외(self):
        p = self._posting(company_name="한영회계법인", title="[EY한영] 신입/경력직")
        self.assertFalse(C.classify(p)["is_target"])

    def test_마감된_공고는_제외(self):
        p = self._posting(deadline=date.today() - timedelta(days=1))
        self.assertFalse(C.classify(p)["is_target"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
