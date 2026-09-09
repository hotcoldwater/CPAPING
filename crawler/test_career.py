"""경력 게시판 분류 — 회계사 공고와 직원 공고를 가르고, 연차를 읽고, 게시판별 대상 규칙을 지킨다.

제목들은 2026-09-09 한공회 구인(CPA) 게시판에 실제로 있던 것이다.
"""
from __future__ import annotations

import unittest
from datetime import date, timedelta
from types import SimpleNamespace

import classify as C


def posting(title, board="cpa", company="어느회계법인", career="", body=""):
    return SimpleNamespace(
        title=title, board=board, company_name=company, career=career, body=body,
        deadline=date.today() + timedelta(days=10), hiring_status="",
    )


class AudienceTest(unittest.TestCase):
    def test_직원_공고는_staff(self):
        for t in ["[현대회계법인] 대전지점 기장 직원모집",
                  "사생활을 중요시하며 혼밥을 좋아하는 세무대리인을 구인합니다.",
                  "[여의도] 회계법인 정후 기장직원 신입ㆍ경력 채용",
                  "[다산회계법인 2본부] 법인세무대리 경력3~5년차 채용 공고",
                  "<총무부 직원 모집 ( 신입 및 2년 이내 경력)>",
                  "경력직 BPO 담당 직원 채용 - 국제조세 부문",
                  "경력직 회계사무소 직원 구인",                 # '회계사무소' 는 회계사가 아니다
                  "[삼정KPMG] IM4본부 사업비 정산 보조 인턴 채용",
                  "평생 함께 할 직원을 채용합니다."]:
            self.assertEqual(C.classify_audience(t)[0], C.AUDIENCE_STAFF, t)

    def test_회계사_공고는_cpa(self):
        for t in ["[삼정KPMG] Deal Adv 4본부 가치평가 경력직 채용",
                  "[삼정KPMG] Deal Adv 5본부 M&A 딜자문 경력직 채용",
                  "감사본부 경력 회계사 채용",
                  "세무대리 업무 담당 회계사 모집",       # 직원 단어가 있어도 '회계사' 가 이긴다
                  "[삼율회계법인] AICPA 모집",
                  "[태성회계법인] 경력 공인회계사 구인",
                  "FAS 시니어 채용"]:
            self.assertEqual(C.classify_audience(t)[0], C.AUDIENCE_CPA, t)

    def test_단서_없으면_unknown_본문이_결정(self):
        t = "출산/육아휴직 대체 근로자 채용(1년 근무)"
        self.assertEqual(C.classify_audience(t)[0], C.AUDIENCE_UNKNOWN)
        self.assertEqual(C.classify_audience(t, body="자격요건: 공인회계사 자격 보유자")[0], C.AUDIENCE_CPA)
        self.assertEqual(C.classify_audience(t, body="담당 업무: 기장 및 부가세 신고")[0], C.AUDIENCE_STAFF)

    def test_수습_게시판은_항상_cpa(self):
        self.assertEqual(C.classify_audience("기장 직원 모집", board="trainee")[0], C.AUDIENCE_CPA)


class CareerYearsTest(unittest.TestCase):
    def test_연차(self):
        self.assertEqual(C.extract_career_years("3~5년"), (3, 5))
        self.assertEqual(C.extract_career_years("5년 이상"), (5, None))
        self.assertEqual(C.extract_career_years("", "(우덕회계법인)3년차이상 경력직원 구합니다"), (3, None))
        self.assertEqual(C.extract_career_years("", "[선율회계법인] 경력 직원(3년 이하) 채용"), (None, 3))
        self.assertEqual(C.extract_career_years("무관", "경력직 채용"), (None, None))


class TargetRuleTest(unittest.TestCase):
    def test_경력_회계사_공고는_빅4도_대상(self):
        L = C.classify(posting("[삼정KPMG] Deal Adv 4본부 가치평가 경력직 채용", company="삼정KPMG", career="3~5년"))
        self.assertTrue(L["is_big4"]); self.assertTrue(L["is_target"]); self.assertFalse(L["needs_review"])
        self.assertEqual((L["career_min_years"], L["career_max_years"]), (3, 5))

    def test_경력_직원_공고는_제외(self):
        L = C.classify(posting("[현대회계법인] 대전지점 기장 직원모집"))
        self.assertFalse(L["is_target"]); self.assertFalse(L["needs_review"]); self.assertEqual(L["audience"], "staff")

    def test_경력_판단불가는_검수_큐로(self):
        L = C.classify(posting("출산/육아휴직 대체 근로자 채용(1년 근무)"))
        self.assertFalse(L["is_target"]); self.assertTrue(L["needs_review"]); self.assertEqual(L["audience"], "unknown")

    def test_수습_규칙은_그대로(self):
        L = C.classify(posting("수습회계사 모집", board="trainee"))
        self.assertTrue(L["is_target"]); self.assertEqual(L["audience"], "cpa")
        L = C.classify(posting("수습회계사 모집", board="trainee", company="삼일회계법인"))
        self.assertFalse(L["is_target"])   # 수습은 빅4 제외 유지


if __name__ == "__main__":
    unittest.main()
