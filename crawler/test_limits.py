"""발송 한도와 경고 주기 테스트.

    python crawler/test_limits.py

여기 있는 것은 전부 순수 함수다. DB 나 메일을 부르지 않는다.
한도 계산이 틀리면 조용히 틀린다 — 메일이 안 나가거나, 경고가 하루에
백 번 나가거나. 눈으로는 확인하기 어려운 종류라 테스트로 고정해 둔다.
"""

from __future__ import annotations

import sys

import main
from main import ONCE, _crossed
from store import mails_from_logs

failures: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"  ✓ {label}")
    else:
        print(f"  ✗ {label}: {got!r} (기대 {want!r})")
        failures.append(label)


def test_mails_from_logs() -> None:
    print("\n발송 로그에서 통수 세기")

    check("빈 로그", mails_from_logs([]), 0)

    # 한 사람에게 공고 세 건을 한 통으로 보낸 경우.
    # log_notifications 가 한 번의 INSERT 로 넣으므로 sent_at 이 같다.
    one_mail = [
        {"subscriber_id": 1, "posting_id": 10, "sent_at": "2026-09-02T01:00:00+00:00"},
        {"subscriber_id": 1, "posting_id": 11, "sent_at": "2026-09-02T01:00:00+00:00"},
        {"subscriber_id": 1, "posting_id": 12, "sent_at": "2026-09-02T01:00:00+00:00"},
    ]
    check("공고 3건을 묶은 한 통은 1통", mails_from_logs(one_mail), 1)

    # 같은 사람이라도 회차가 다르면 다른 통이다
    two_runs = one_mail + [
        {"subscriber_id": 1, "posting_id": 13, "sent_at": "2026-09-02T02:00:00+00:00"},
    ]
    check("회차가 다르면 다른 통", mails_from_logs(two_runs), 2)

    # 한 회차에 구독자 셋에게 나가면 3통
    broadcast = [
        {"subscriber_id": s, "posting_id": 10, "sent_at": "2026-09-02T03:00:00+00:00"}
        for s in (1, 2, 3)
    ]
    check("구독자 3명이면 3통", mails_from_logs(broadcast), 3)

    check("섞여 있어도 맞다", mails_from_logs(two_runs + broadcast), 5)


def test_crossed_once() -> None:
    print("\n한 번만 알리는 경계 (한도 경고)")

    check("아직 못 미쳤다", _crossed(60, 70, 80, ONCE), False)
    check("이번 회차에 넘었다", _crossed(70, 85, 80, ONCE), True)
    check("정확히 임계값이면 넘은 것", _crossed(70, 80, 80, ONCE), True)
    check("이미 넘어 있었으면 다시 안 보낸다", _crossed(85, 95, 80, ONCE), False)
    check("한참 넘어도 다시 안 보낸다", _crossed(85, 300, 80, ONCE), False)


def test_crossed_repeating() -> None:
    print("\n주기마다 다시 알리는 경계 (정체 경고)")

    # 72시간을 넘을 때 한 번, 그 뒤로는 24시간마다 한 번
    check("70 → 71 시간: 아직", _crossed(70, 71, 72, 24), False)
    check("71 → 72.2 시간: 처음 넘음", _crossed(71, 72.2, 72, 24), True)
    check("72.2 → 72.4 시간: 같은 구간", _crossed(72.2, 72.4, 72, 24), False)
    check("95.9 → 96.1 시간: 다음 구간", _crossed(95.9, 96.1, 72, 24), True)
    check("96.1 → 96.3 시간: 같은 구간", _crossed(96.1, 96.3, 72, 24), False)
    check("119.9 → 120.1 시간: 또 다음 구간", _crossed(119.9, 120.1, 72, 24), True)

    # 회차를 통째로 걸러도 경계는 놓치지 않는다.
    # (before 가 그만큼 낮으므로 구간 번호가 달라진다)
    check("회차가 빠져 크게 뛰어도 잡는다", _crossed(70, 100, 72, 24), True)


class FakeStore:
    """_notify_subscribers 가 부르는 것만 흉내낸다."""

    def __init__(self, pending: dict[int, list[str]], sent_today: int = 0):
        # {구독자 id: [공고가 처음 보인 시각, ...]}
        self.pending = pending
        self.sent_today = sent_today
        self.logged: list[int] = []

    def mails_sent_today(self) -> int:
        return self.sent_today

    def active_subscribers(self) -> list[dict]:
        return [{"id": i, "email": f"s{i}@example.com", "employment_filter": "all"}
                for i in sorted(self.pending)]

    def postings_for_subscriber(self, source, subscriber) -> list[dict]:
        return [{"id": n, "first_seen_at": seen}
                for n, seen in enumerate(self.pending[subscriber["id"]])]

    def log_notifications(self, subscriber_id, posting_ids) -> None:
        self.logged.append(subscriber_id)


class FakeNotify:
    def __init__(self):
        self.sent: list[int] = []
        self.alerts: list[str] = []

    def send_to_subscriber(self, subscriber, rows) -> None:
        self.sent.append(subscriber["id"])

    def send_alert(self, subject, message) -> None:
        self.alerts.append(subject)


def run_notify(pending: dict[int, list[str]], sent_before: int):
    """notify 를 가짜로 바꿔 끼우고 발송 단계만 돌린다."""
    store_ = FakeStore(pending, sent_today=sent_before)
    fake = FakeNotify()
    real, main.notify = main.notify, fake
    try:
        main._notify_subscribers(store_, "kicpa:trainee", True)
    finally:
        main.notify = real
    return fake, store_


def test_budget_and_order() -> None:
    print("\n한도 강제와 발송 순서")

    # 세 명 모두 보낼 몫이 있고 한도에도 여유가 있다
    fake, store_ = run_notify({1: ["2026-09-04T00:00:00"],
                               2: ["2026-09-04T00:00:00"],
                               3: ["2026-09-04T00:00:00"]}, sent_before=0)
    check("여유가 있으면 모두 보낸다", sorted(fake.sent), [1, 2, 3])

    # 남은 몫이 2통뿐이다 — 오래 기다린 두 명만 나가야 한다
    fake, store_ = run_notify({1: ["2026-09-05T00:00:00"],
                               2: ["2026-09-03T00:00:00"],   # 가장 오래 기다렸다
                               3: ["2026-09-04T00:00:00"]},
                              sent_before=main.DAILY_MAIL_LIMIT - 2)
    check("한도만큼만 보낸다", len(fake.sent), 2)
    check("오래 기다린 사람부터", fake.sent, [2, 3])
    check("못 보낸 건은 로그도 안 남는다", store_.logged, [2, 3])

    # 이미 한도를 다 썼다
    fake, _ = run_notify({1: ["2026-09-04T00:00:00"]},
                         sent_before=main.DAILY_MAIL_LIMIT)
    check("한도를 다 썼으면 한 통도 안 보낸다", fake.sent, [])

    # 한 사람이 공고 세 건을 한 통으로 받는다 — 통수는 1이다
    fake, _ = run_notify({1: ["2026-09-04T00:00:00"] * 3},
                         sent_before=main.DAILY_MAIL_LIMIT - 1)
    check("공고가 여러 건이어도 한 통", fake.sent, [1])


def main_() -> int:
    print("한도·경고 테스트")
    test_mails_from_logs()
    test_crossed_once()
    test_crossed_repeating()
    test_budget_and_order()

    print()
    if failures:
        print(f"실패 {len(failures)}건: {', '.join(failures)}")
        return 1
    print("전부 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main_())
