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
import sys
import traceback

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

# 확인하지 않은 구독 신청의 보유기간. 개인정보처리방침 제3조와 같아야 한다.
PENDING_RETENTION_DAYS = 7

# Resend 무료 티어는 하루 100통이다. 공고 1건이 뜨면 구독자 수만큼 나가므로
# 구독자가 이 수를 넘으면 하루에 공고가 두 번만 떠도 한도를 넘긴다.
# 넘기 전에 알아야 유료 전환을 준비할 수 있다.
SUBSCRIBER_WARN_THRESHOLD = 70


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
        stale = db.hours_since_last_new_posting(source)
        if stale is not None and stale > STALE_ALERT_HOURS:
            log.warning("%.0f시간째 신규 공고 없음", stale)

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


def _send_pending_confirmations(db) -> None:
    """확인 메일을 아직 못 보낸 신청 건을 처리한다."""
    waiting = db.pending_confirmations()
    for row in waiting:
        try:
            notify.send_confirmation(row["email"], row["confirm_token"],
                                     row.get("unsubscribe_token", ""))
            db.mark_confirmation_sent(row["id"])
        except Exception as exc:
            log.warning("확인 메일 발송 실패 (%s): %s", row["email"], exc)
    if waiting:
        log.info("확인 메일 %d건 발송", len(waiting))


def _notify_subscribers(db, source: str, send_mail: bool) -> int:
    """구독자별로 아직 안 보낸 공고를 골라 발송한다."""
    subscribers = db.active_subscribers()
    if not subscribers:
        return 0

    if len(subscribers) >= SUBSCRIBER_WARN_THRESHOLD:
        log.warning(
            "구독자 %d명 — Resend 무료 티어(하루 100통)에 가까워졌습니다. "
            "유료 전환을 검토하세요.", len(subscribers)
        )

    total = 0
    for subscriber in subscribers:
        rows = db.postings_for_subscriber(source, subscriber)
        if not rows:
            continue
        if not send_mail:
            log.info("%s 에게 보낼 공고 %d건 (--no-mail)", subscriber["email"], len(rows))
            continue
        try:
            notify.send_to_subscriber(subscriber, rows)
            db.log_notifications(subscriber["id"], [r["id"] for r in rows])
            total += len(rows)
        except Exception as exc:
            # 한 명이 실패해도 나머지는 계속 보낸다
            log.warning("발송 실패 (%s): %s", subscriber["email"], exc)

    if total:
        log.info("구독자 %d명에게 공고 %d건 발송", len(subscribers), total)
    return total


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
        return crawl(dry_run=args.dry_run, send_mail=not args.no_mail, board=args.board)
    except Exception as exc:
        log.error("크롤 실패: %s", exc)
        traceback.print_exc()
        # 실패를 조용히 넘기지 않고 관리자에게 알린다
        if not args.dry_run:
            try:
                notify.send_alert("크롤러 실패", f"{type(exc).__name__}: {exc}\n\n{traceback.format_exc()}")
            except Exception as mail_exc:
                log.error("장애 알림 발송도 실패: %s", mail_exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
