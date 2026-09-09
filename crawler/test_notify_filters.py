"""종류 스위치(수습 정규·수습 파트·경력)가 게시판별 고용형태 조건으로 바뀌는지."""
from __future__ import annotations

import unittest

from notify import _career_note
from store import SKIP, wanted_employment

T, C = "kicpa:trainee", "kicpa:cpa"


class WantedEmployment(unittest.TestCase):
    def test_기존_구독자_기본값은_수습_둘_다_경력은_안_받음(self):
        sub = {"want_trainee_full": True, "want_trainee_part": True, "want_career": False}
        self.assertIsNone(wanted_employment(T, sub))
        self.assertEqual(wanted_employment(C, sub), SKIP)

    def test_정규만_파트만(self):
        self.assertEqual(wanted_employment(T, {"want_trainee_full": True, "want_trainee_part": False}), "neq.Part Time")
        self.assertEqual(wanted_employment(T, {"want_trainee_full": False, "want_trainee_part": True}), "eq.Part Time")

    def test_경력만(self):
        sub = {"want_trainee_full": False, "want_trainee_part": False, "want_career": True}
        self.assertEqual(wanted_employment(T, sub), SKIP)
        self.assertIsNone(wanted_employment(C, sub))

    def test_스위치_없는_옛_행은_수습_전부(self):
        self.assertIsNone(wanted_employment(T, {}))
        self.assertEqual(wanted_employment(C, {}), SKIP)


class CareerNote(unittest.TestCase):
    def test_연차_문구(self):
        self.assertEqual(_career_note({"career_min_years": 3, "career_max_years": 5}), "경력 3~5년")
        self.assertEqual(_career_note({"career_min_years": 5, "career_max_years": None}), "경력 5년 이상")
        self.assertEqual(_career_note({"career_min_years": None, "career_max_years": 3}), "경력 3년 이하")
        self.assertEqual(_career_note({}), "")


if __name__ == "__main__":
    unittest.main()
