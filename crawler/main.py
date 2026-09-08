"""CPAPING 크롤러 엔트리포인트.

    python crawler/main.py --dry-run    수집·분류 결과만 출력 (DB/메일 없음)
    python crawler/main.py              수집 → DB 저장 → 신규 건 메일 발송
    python crawler/main.py --no-mail    저장은 하되 메일은 보내지 않음

MVP 는 '구인(수습CPA)' 게시판만 본다. 이 게시판은 한공회가 수습회계사 및
시험 합격자 대상 공고만 받도록 운영해서, 올라온 글이 곧 신입 공고다.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import traceback
from datetime import datetime, timezone

from dotenv import load_dotenv

import classify
import firms
import kicpa
import notify
import repost
import store

log = logging.getLogger("cpaping")

# 이 시간 넘게 신규 공고가 하나도 없으면 파서가 깨졌을 가능성을 의심한다.
STALE_ALERT_HOURS = 72
# 그 뒤로는 이 간격으로 한 번씩 다시 알린다. 한 번만 보내면 놓쳤을 때
# 되돌아올 길이 없고, 회차마다 보내면 10분마다 같은 메일이 나간다.
STALE_REPEAT_HOURS = 24

# 확인하지 않은 구독 신청의 보유기간. 개인정보처리방침 제3조와 같아야 한다.
PENDING_RETENTION_DAYS = 7

# 2026-09-08 Resend Pro 로 올렸다. **일일 캡은 사라졌고 월 50,000통**이다.
# 아래 값은 요금제 한도가 아니라 **폭주 방지용 안전망**이다. 버그로 같은 메일을
# 반복 발송하면 한 달치를 하루에 태울 수 있어서 남겨 둔다.
#
# 통수를 좌우하는 것은 공고 수가 아니라 '신규 공고가 발견된 회차 수' 다.
# 한 회차에 공고가 6건 떠도 구독자당 한 통으로 묶여 구독자 수만큼만 나가고,
# 공고가 1건씩 4회차에 나뉘어 뜨면 그 네 배가 나간다. 2026-09-08 이 후자였다
# (구독자 24명 · 4회차 · 94통). 무료 티어의 100통은 여기서 바닥났다.
#
# 1,500통이면 월 45,000통으로 요금제 안에 들어오고, 구독자 200명이라도
# 하루 7회차를 감당한다. 요금제를 바꾸면 코드 대신 환경변수로 조정한다.
DAILY_MAIL_LIMIT = int(os.environ.get("DAILY_MAIL_LIMIT", "1500"))
DAILY_MAIL_WARN = int(DAILY_MAIL_LIMIT * 0.8)

# 확인 메일이 하루에 쓸 수 있는 몫. functions/api/subscribe.js 의 같은 이름과
# 맞춰 둔다. 신청 API 가 천장에서 멈춰도 크롤러가 대신 보내 버리면 천장이
# 없는 것과 같다.
#
# 이것은 요금제와 무관한 **남용 방지 천장**이다. 홍보를 열면 신청이 몰릴 수
# 있어(지금까지 가장 많은 날이 11건) 정상 이용을 막지 않도록 넉넉히 둔다.
DAILY_CONFIRMATION_LIMIT = int(os.environ.get("DAILY_CONFIRMATION_LIMIT", "300"))

# 한 번만 알리고 반복하지 않는다는 뜻. _crossed 의 period 로 쓴다.
ONCE = float("inf")


def crawl(dry_run: bool = False, send_mail: bool = True,
          board: str = kicpa.BOARD_TRAINEE) -> int:
    source = f"kicpa:{board}"
    session = kicpa.make_session()

    # 1. 목록 (상세는 신규 건만 — 상대 서버 부담을 줄인다)
    postings, total = kicpa.fetch_list(session, board=board, list_cnt=50)
    log.info("%s 목록 %d건 (전체 %s건)", kicpa.BOARDS[board][1], len(postings), total)

    if not postings:
        raise RuntimeError("목록이 비어 있습니다 — 사이트 구조가 바뀌었을 수 있습니다")

    db = None if dry_run else store.Store()
    run_id = db.start_run(board) if db else None

    try:
        known = db.existing_ij_ids(source) if db else set()
        fresh = [p for p in postings if p.ij_id not in known]
        log.info("신규 %d건 / 기존 %d건", len(fresh), len(postings) - len(fresh))

        # 2. 상세 조회 — 신규 건만. dry-run 은 전부 본다.
        targets = postings if dry_run else fresh
        for i, p in enumerate(targets, 1):
            kicpa.fetch_detail(session, p)
            if i < len(targets):
                import time
                time.sleep(kicpa.REQUEST_DELAY_SEC)
        log.info("상세 조회 %d건", len(targets))

        # 3. 분류
        for p in postings:
            classify.classify(p)

        # 3-1. 끌올 판정 — 신규 건만. 같은 법인의 과거 공고와 대조한다.
        if not dry_run:
            _detect_reposts(db, source, fresh)

        if dry_run:
            _print_dry_run(postings)
            return 0

        # 4. 저장
        # 신규 건은 상세까지 있으니 전체 저장, 기존 건은 목록에서 확인되는
        # 값만 갱신한다. 상세를 조회하지 않은 채 전체를 덮어쓰면 마감일과
        # 본문이 지워진다.
        fresh_ids = {p.ij_id for p in fresh}
        db.upsert_postings([store.to_row(p) for p in postings if p.ij_id in fresh_ids])
        db.upsert_postings([store.to_light_row(p) for p in postings if p.ij_id not in fresh_ids])

        expired = db.expire_past_deadline(source)
        if expired:
            log.info("마감일이 지난 공고 %d건 만료 처리", expired)

        # 4-1. 공고에서 법인을 추려 firms 를 갱신한다.
        # 사람이 채운 재무 컬럼은 건드리지 않는다.
        firms.sync(db, source)

        removed = db.mark_removed(source, [p.ij_id for p in postings])
        if removed:
            log.info("게시판에서 사라진 공고 %d건에 removed_at 기록", removed)

        # 5. 보유기간이 지난 개인정보 정리 (개인정보처리방침 제3조)
        _purge_expired_personal_data(db)

        # 6. 확인 메일 (Pages Function 이 못 보낸 건을 대신 보낸다)
        if send_mail:
            _send_pending_confirmations(db)

        # 7. 알림 — 구독자별로 보낸다
        # 6 이 보낸 통수는 mark_confirmation_sent 로 이미 DB 에 남았으므로
        # 7 이 다시 세면 그대로 반영된다. 따로 넘겨줄 것이 없다.
        notified = _notify_subscribers(db, source, send_mail)

        # 관리자에게도 계속 보낸다. 구독자가 없어도 서비스가 살아있는지 확인할 수 있다.
        pending = db.unnotified_targets(source)
        if pending and send_mail:
            notify.send_new_postings(pending)
            db.mark_notified([r["id"] for r in pending])
            log.info("관리자 알림 %d건", len(pending))
        elif pending:
            log.info("관리자 알림 대상 %d건 (--no-mail 이라 발송 생략)", len(pending))

        # 8. 정체 감지
        _alert_if_stale(db, source, board, send_mail)

        db.finish_run(
            run_id, status="success", fetched_count=len(postings),
            new_count=len(fresh), updated_count=len(postings) - len(fresh),
            notified_count=notified,
        )
        log.info("완료: 수집 %d / 신규 %d / 알림 %d", len(postings), len(fresh), notified)
        return 0

    except Exception as exc:
        if db:
            db.finish_run(run_id, status="failed", error=f"{type(exc).__name__}: {exc}"[:2000])
        raise


def _detect_reposts(db, source: str, postings: list) -> None:
    """신규 공고가 같은 법인의 과거 공고를 다시 올린 것인지 판정한다."""
    seen: dict[str, list] = {}
    found = 0
    for p in postings:
        if p.company_name not in seen:
            seen[p.company_name] = db.company_history(source, p.company_name)
        p.repost = repost.repost_fields(p, seen[p.company_name])
        if p.repost["original_id"]:
            found += 1
            log.info("끌올 감지: %s — %s (최초 %s, %d번째 재등록)",
                     p.company_name, p.title[:30],
                     p.repost["original_posted_at"], p.repost["repost_count"])
    if postings and not found:
        log.info("끌올 없음 (신규 %d건 모두 최초 공고)", len(postings))


def _purge_expired_personal_data(db) -> None:
    """개인정보처리방침이 정한 보유기간이 지난 정보를 지운다.

    방침에 적어만 두고 지우지 않으면 지키지 않는 약속이 된다.
    크롤이 10분마다 도니 사실상 상시 정리된다.
    """
    stale = db.purge_stale_pending(days=PENDING_RETENTION_DAYS)
    if stale:
        log.info("미확인 신청 %d건 삭제 (신청 후 %d일 경과)", stale, PENDING_RETENTION_DAYS)

    leftover = db.purge_unsubscribed()
    if leftover:
        log.info("해지 후 남아 있던 %d건 삭제", leftover)


def _send_pending_confirmations(db) -> int:
    """확인 메일을 아직 못 보낸 신청 건을 처리한다. 실제로 보낸 통수를 돌려준다.

    누군가 주소를 바꿔 가며 신청 API 를 두들겨도 구독자 알림에 쓸 몫까지
    가져가지는 못하게 두 가지 천장을 본다 — 확인 메일 자체의 하루 몫과,
    오늘 남은 전체 발송 몫. 보낼 것이 있을 때만 센다.
    """
    waiting = db.pending_confirmations()
    if not waiting:
        return 0

    room = min(DAILY_MAIL_LIMIT - db.mails_sent_today(),
               DAILY_CONFIRMATION_LIMIT - db.confirmations_sent_today())
    if room <= 0:
        log.warning("확인 메일 하루 몫을 다 썼습니다 (대기 %d건) — 다음 회차로 미룹니다",
                    len(waiting))
        return 0

    waiting = waiting[:room]
    sent = 0
    for row in waiting:
        try:
            notify.send_confirmation(row["email"], row["confirm_token"],
                                     row.get("unsubscribe_token", ""))
            db.mark_confirmation_sent(row["id"])
            sent += 1
        except Exception as exc:
            log.warning("확인 메일 발송 실패 (%s): %s", row["email"], exc)
    if waiting:
        log.info("확인 메일 %d건 발송", sent)
    return sent


def _notify_subscribers(db, source: str, send_mail: bool) -> int:
    """구독자별로 아직 안 보낸 공고를 골라 발송한다.

    하루 한도가 있으므로 두 가지를 지킨다.

    - **한도를 넘으면 보내지 않는다.** 넘긴 뒤에 부르면 Resend 가 거절하고,
      429 재시도로 회차 시간만 버린다. 발송에 성공해야 로그를 남기므로
      보내지 못한 건은 다음 회차에 그대로 다시 잡힌다.
    - **오래 기다린 사람부터 보낸다.** 전에는 DB 가 돌려주는 순서 그대로
      돌아서, 한도에 걸리는 날마다 같은 뒷사람만 계속 밀렸다.
    """
    subscribers = db.active_subscribers()
    if not subscribers:
        return 0

    # (가장 오래 기다린 공고, 구독자, 보낼 공고들)
    queue = []
    for subscriber in subscribers:
        rows = db.postings_for_subscriber(source, subscriber)
        if rows:
            queue.append((min(r["first_seen_at"] for r in rows), subscriber, rows))
    if not queue:
        return 0

    if not send_mail:
        for _, subscriber, rows in queue:
            log.info("%s 에게 보낼 공고 %d건 (--no-mail)", subscriber["email"], len(rows))
        return 0

    queue.sort(key=lambda item: item[0])

    # 보낼 것이 있을 때만 센다. 조용한 회차마다 세면 하루 수백 번 헛돈다.
    sent_before = db.mails_sent_today()
    budget = DAILY_MAIL_LIMIT - sent_before

    total = 0    # 공고 건수 (crawl_runs.notified_count 로 들어간다)
    mails = 0    # 실제로 나간 통수 — 한 구독자에게 여러 공고를 한 통에 묶는다
    skipped = 0
    for _, subscriber, rows in queue:
        if mails >= budget:
            skipped += 1
            continue
        try:
            notify.send_to_subscriber(subscriber, rows)
            db.log_notifications(subscriber["id"], [r["id"] for r in rows])
            total += len(rows)
            mails += 1
        except Exception as exc:
            # 한 명이 실패해도 나머지는 계속 보낸다
            log.warning("발송 실패 (%s): %s", subscriber["email"], exc)

    if total:
        log.info("구독자 %d명에게 공고 %d건 발송 (%d통)", len(subscribers), total, mails)
    if skipped:
        log.warning("하루 한도(%d통)에 걸려 %d명 발송을 다음 회차로 미룹니다 "
                    "(오늘 %d통)", DAILY_MAIL_LIMIT, skipped, sent_before + mails)
    _warn_if_near_daily_limit(sent_before, sent_before + mails, len(subscribers), skipped)
    return total


def _crossed(before: float, after: float, first: float, period: float) -> bool:
    """처음 first 를 넘는 순간, 그 뒤로는 period 마다 한 번씩만 True.

    크롤이 10분마다 도니 '넘었으면 보낸다' 로 두면 같은 경고가 하루에 백 번
    넘게 나가고, 그 경고 자체가 메일 한도를 먹는다. 직전 값과 견주어 경계를
    넘는 회차에서만 보낸다. 회차를 걸러도 before 가 그만큼 낮아지므로
    경계는 그대로 잡힌다.
    """
    if after < first:
        return False
    n_after = int((after - first) // period)
    n_before = -1 if before < first else int((before - first) // period)
    return n_after > n_before


def _warn_if_near_daily_limit(before: int, after: int, subscriber_count: int,
                              skipped: int = 0) -> None:
    """임계값을 넘어서는 회차에서 딱 한 번 알린다."""
    if not _crossed(before, after, DAILY_MAIL_WARN, ONCE):
        return
    tail = (f"\n이번 회차에서 {skipped}명은 한도에 걸려 다음으로 미뤘습니다.\n"
            if skipped else "\n")
    try:
        notify.send_alert(
            "Resend 일일 한도 임박",
            f"오늘(UTC) {after}통 발송 — 안전망 {DAILY_MAIL_LIMIT}통.\n"
            f"활성 구독자 {subscriber_count}명.\n"
            f"{tail}\n"
            f"이 숫자는 요금제 한도가 아니라 폭주 방지용 안전망입니다.\n"
            f"Resend Pro 는 일일 캡이 없고 월 50,000통이므로, 정상적인 증가라면\n"
            f"DAILY_MAIL_LIMIT 환경변수를 올리면 됩니다. 예상 밖의 숫자라면\n"
            f"같은 메일이 반복 발송되고 있지 않은지 먼저 확인하세요.\n\n"
            f"https://resend.com/emails"
        )
    except Exception as exc:
        log.warning("한도 경고를 못 보냈습니다: %s", exc)


def _alert_if_stale(db, source: str, board: str, send_mail: bool) -> None:
    """신규 공고가 오래 끊기면 메일로 알린다.

    전에는 로그만 남겼다. GitHub Actions 로그를 들여다보지 않으면 파서가
    깨진 것을 몇 주 동안 모를 수 있었다. 한공회에 공고가 실제로 없는 날도
    있으므로 실패로 다루지는 않고, 사람이 판단하도록 알리기만 한다.
    """
    stale = db.hours_since_last_new_posting(source)
    if stale is None or stale <= STALE_ALERT_HOURS:
        return
    log.warning("%.0f시간째 신규 공고 없음", stale)
    if not send_mail:
        return

    previous = db.previous_run_started_at(board)
    if previous is None:
        return    # 첫 회차 — 견줄 대상이 없다
    gap = (datetime.now(timezone.utc) - previous).total_seconds() / 3600
    if not _crossed(stale - gap, stale, STALE_ALERT_HOURS, STALE_REPEAT_HOURS):
        return

    try:
        notify.send_alert(
            "신규 공고가 오래 끊겼습니다",
            f"{stale:.0f}시간째 새 공고를 하나도 보지 못했습니다.\n\n"
            f"한공회에 정말 공고가 없을 수도 있고, 게시판 구조가 바뀌어\n"
            f"파서가 조용히 빈 결과를 내고 있을 수도 있습니다.\n\n"
            f"게시판을 직접 확인해 보세요:\n"
            f"https://www.kicpa.or.kr/home/jobOffrSrchNewGnrl/list.face?listCnt=50\n\n"
            f"이 알림은 {STALE_REPEAT_HOURS}시간마다 한 번씩 다시 옵니다."
        )
    except Exception as exc:
        log.warning("정체 경고를 못 보냈습니다: %s", exc)


def _print_dry_run(postings: list) -> None:
    targets = [p for p in postings if p.labels["is_target"]]
    print(f"\n{'=' * 76}")
    print(f"수집 {len(postings)}건 → 알림 대상 {len(targets)}건\n")
    for p in postings:
        L = p.labels
        if L["is_target"]:
            mark = "🎯"
        elif L["is_big4"]:
            mark = f"빅4({L['big4']})"
        elif L["is_expired"]:
            mark = "마감"
        else:
            mark = "제외"
        print(f"{mark:9s} {p.title[:50]}")
        print(f"          {p.company_name} | {p.region} | {p.employment_type} | ~{p.deadline}")
        print(f"          유형={L['posting_type']} ({L['posting_type_reason']})")
        print(f"          직무={L['job_category']}/{L['job_category_confidence']} ({L['job_category_reason']})")
    print(f"{'=' * 76}")
    print("dry-run 이므로 DB 저장과 메일 발송은 하지 않았습니다.")


def main() -> int:
    parser = argparse.ArgumentParser(description="CPAPING 한공회 공고 크롤러")
    parser.add_argument("--dry-run", action="store_true",
                        help="DB 저장과 메일 발송 없이 결과만 출력")
    parser.add_argument("--no-mail", action="store_true", help="저장만 하고 메일은 생략")
    parser.add_argument("--board", default=kicpa.BOARD_TRAINEE,
                        choices=list(kicpa.BOARDS), help="수집할 게시판")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    try:
        code = crawl(dry_run=args.dry_run, send_mail=not args.no_mail, board=args.board)
        if not args.dry_run:
            notify.ping_healthcheck(ok=True)
        return code
    except Exception as exc:
        log.error("크롤 실패: %s", exc)
        traceback.print_exc()
        # 실패를 조용히 넘기지 않고 관리자에게 알린다
        if not args.dry_run:
            # 핑을 먼저 보낸다. 메일 경로가 통째로 죽어 있어도 밖에서는
            # 실패했다는 사실이 남는다.
            notify.ping_healthcheck(ok=False)
            try:
                notify.send_alert("크롤러 실패", f"{type(exc).__name__}: {exc}\n\n{traceback.format_exc()}")
            except Exception as mail_exc:
                log.error("장애 알림 발송도 실패: %s", mail_exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
