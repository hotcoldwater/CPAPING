"""검산 규칙이 실제로 잡는지 확인한다.

정상 자료가 통과하는 것만으로는 부족하다. 아무것도 잡지 않는 검산도
똑같이 '전부 통과' 로 보이기 때문이다. 그래서 규칙마다 일부러 망친
값을 하나씩 넣어 본다.

기준이 되는 정상 행은 성현회계법인 2022.03 실제 값이다.
"""

import unittest

from dart_extract import HARD, SOFT, check_row, check_series


def row(**over):
    base = {
        "기준연도": "2022.03",
        "매출액_억원": 457.29,
        "감사매출_억원": 198.47,
        "세무매출_억원": 105.00,
        "딜자문매출_억원": 148.05,
        "기타매출_억원": 5.77,
        "감사비중_pct": 43.40,
        "세무비중_pct": 22.96,
        "딜자문비중_pct": 32.37,
        "기타비중_pct": 1.27,
        "회계사수": 157,
        "수습CPA수": 29,
        "파트너수": 33,
        "_member": 33,
        "_cpa_total": 186,      # 회계사 157 + 수습 29
    }
    base.update(over)
    return base


def reasons(r):
    return [m for _, m in check_row(r)]


def levels(r):
    return [lvl for lvl, _ in check_row(r)]


class 정상값(unittest.TestCase):
    def test_실제_보고서_값은_통과한다(self):
        self.assertEqual(check_row(row()), [])

    def test_반올림_오차는_통과한다(self):
        # 부문합이 합계와 0.01 억 어긋나는 경우는 흔하다
        self.assertEqual(check_row(row(기타매출_억원=5.78)), [])
        self.assertEqual(check_row(row(기타비중_pct=1.28)), [])


class 매출검산(unittest.TestCase):
    def test_부문_하나가_통째로_빠지면_잡는다(self):
        # 동현 2022.03 에서 실제로 났던 사고: '기타' 부문이 0 이 됐다
        out = reasons(row(기타매출_억원=0.0))
        self.assertTrue(any("부문합" in m for m in out), out)

    def test_부문합이_어긋나면_격리한다(self):
        self.assertIn(HARD, levels(row(감사매출_억원=250.0)))

    def test_비중합이_100이_아니면_잡는다(self):
        out = reasons(row(기타비중_pct=0.0))
        self.assertTrue(any("비중합" in m for m in out), out)

    def test_매출이_없으면_격리한다(self):
        self.assertIn(HARD, levels(row(매출액_억원=None)))

    def test_매출이_0이면_격리한다(self):
        self.assertIn(HARD, levels(row(매출액_억원=0)))

    def test_부문에_빈_값이_있으면_격리한다(self):
        self.assertIn(HARD, levels(row(세무매출_억원=None)))


class 인력검산(unittest.TestCase):
    def test_소계가_안_맞으면_격리한다(self):
        out = reasons(row(회계사수=150))
        self.assertTrue(any("인력 소계" in m for m in out), out)

    def test_회계사수가_없으면_격리한다(self):
        self.assertIn(HARD, levels(row(회계사수=None)))

    def test_파트너가_회계사보다_많으면_확인_표시(self):
        # 있을 수 없다고 단정하진 않는다. 외국인 사원이 많으면 가능하다
        out = check_row(row(파트너수=200))
        self.assertEqual([lvl for lvl, _ in out], [SOFT])


class 연도검산(unittest.TestCase):
    def test_기준연도를_못_읽으면_격리한다(self):
        self.assertIn(HARD, levels(row(기준연도="")))

    def test_기준연도가_중복되면_잡는다(self):
        out = check_series([row(), row()])
        self.assertTrue(any("중복" in m for _, m in out["2022.03"]))

    def test_매출이_급변하면_확인_표시(self):
        # 선일의 3 개월 결산 같은 경우. 자동으로 빼되 이유는 남긴다
        out = check_series([
            row(기준연도="2021.03", 매출액_억원=400.0),
            row(기준연도="2022.03", 매출액_억원=29.84),
        ])
        self.assertTrue(any("대비 매출" in m for _, m in out["2022.03"]))

    def test_정상_증가는_통과한다(self):
        out = check_series([
            row(기준연도="2021.03", 매출액_억원=400.0),
            row(기준연도="2022.03", 매출액_억원=457.29),
        ])
        self.assertEqual(out, {})


if __name__ == "__main__":
    unittest.main()
