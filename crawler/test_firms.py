"""법인 URL 충돌이 공고 알림을 중단시켰던 장애의 회귀 테스트."""

from copy import deepcopy
from unittest import TestCase
from unittest.mock import Mock, patch

import firms
import kicpa
import main


OLD_NAME = "하나회계법인 & 프랜차이즈M&A거래소"
NEW_NAME = "하나회계법인 프랜차이즈M&A거래소"
OLD_SLUG = "하나회계법인-프랜차이즈M-A거래소"


def posting(name):
    return {"company_name": name, "posted_at": "2026-10-22"}


class FirmStore:
    """name와 slug의 DB 고유 제약, 부분 upsert를 함께 재현한다."""

    def __init__(self, postings, existing=()):
        self.postings = postings
        self.rows = deepcopy(list(existing))
        self.writes = []

    def _request(self, method, table, **kwargs):
        params = kwargs.get("params", {})
        if method == "GET":
            rows = self.rows if table == "firms" else self.postings
            offset = int(params.get("offset", 0))
            limit = int(params.get("limit", 1000))
            return deepcopy(rows[offset:offset + limit])
        if (method, table) != ("POST", "firms"):
            raise AssertionError((method, table))
        self.writes.extend(deepcopy(kwargs["json"]))
        for row in kwargs["json"]:
            if any(r["slug"] == row["slug"] and r["name"] != row["name"] for r in self.rows):
                raise RuntimeError("duplicate key value violates unique constraint firms_slug_key")
            current = next((r for r in self.rows if r["name"] == row["name"]), None)
            if current is None:
                self.rows.append(deepcopy(row))
            else:
                current.update(row)


class FirmSyncTests(TestCase):
    def test_live_collision_keeps_existing_url_and_manual_data(self):
        db = FirmStore([posting(NEW_NAME)], [{
            "name": OLD_NAME, "slug": OLD_SLUG, "ceo": "수동 입력", "id": 42,
        }])
        self.assertEqual(firms.sync(db, "kicpa:trainee"), 1)
        old, new = db.rows
        self.assertEqual((old["slug"], old["ceo"], old["id"]), (OLD_SLUG, "수동 입력", 42))
        self.assertNotEqual(new["slug"], OLD_SLUG)
        self.assertEqual(new["name"], NEW_NAME)
        self.assertLessEqual(set(db.writes[0]), set(firms.CRAWLER_COLUMNS))
        saved_slug = new["slug"]
        firms.sync(db, "kicpa:trainee")
        self.assertEqual(len(db.rows), 2)
        self.assertEqual(db.rows[1]["slug"], saved_slug)

    def test_collision_inside_one_batch_is_stable_when_input_order_changes(self):
        first = FirmStore([posting(NEW_NAME), posting(OLD_NAME)])
        second = FirmStore(list(reversed(first.postings)))
        firms.sync(first, "kicpa:trainee")
        firms.sync(second, "kicpa:trainee")
        slugs = lambda db: {r["name"]: r["slug"] for r in db.rows}
        self.assertEqual(slugs(first), slugs(second))
        self.assertEqual(len(set(slugs(first).values())), 2)

    def test_existing_custom_url_is_not_regenerated(self):
        db = FirmStore([posting("가나다회계법인")], [{
            "name": "가나다회계법인", "slug": "existing-public-link", "ceo": "수동 입력",
        }])
        firms.sync(db, "kicpa:trainee")
        self.assertEqual(db.rows[0]["slug"], "existing-public-link")
        self.assertEqual(db.rows[0]["ceo"], "수동 입력")

    def test_collision_with_firm_beyond_first_api_page_is_detected(self):
        existing = [{"name": f"법인{i}", "slug": f"firm-{i}"} for i in range(1000)]
        existing.append({"name": OLD_NAME, "slug": OLD_SLUG})
        db = FirmStore([posting(NEW_NAME)], existing)
        firms.sync(db, "kicpa:trainee")
        self.assertEqual(len(db.rows), 1002)
        self.assertNotEqual(db.rows[-1]["slug"], OLD_SLUG)


class FirmMaintenanceFailureTests(TestCase):
    def test_firm_failure_keeps_notifications_and_scan_progress_but_reports_failure(self):
        post = kicpa.Posting(ij_id="known", title="신입 회계사", company_name="테스트회계법인")
        db = Mock()
        db.start_run.return_value = 42
        db.existing_ij_ids.return_value = {"known"}
        db.content_refresh_candidates.return_value = []
        db.unnotified_targets.return_value = []
        db.expire_past_deadline.return_value = 0
        db.mark_removed.return_value = 0
        with patch.object(kicpa, "make_session"), \
             patch.object(kicpa, "fetch_board_inventory", return_value=([post], 1)), \
             patch.object(main.store, "Store", return_value=db), \
             patch.object(main.firms, "sync", side_effect=RuntimeError("firms unavailable")), \
             patch.object(main.analysis_dispatch, "dispatch_pending"), \
             patch.object(main, "_purge_expired_personal_data"), \
             patch.object(main, "_send_pending_confirmations") as confirmations, \
             patch.object(main, "_notify_subscribers", return_value=2) as subscribers, \
             patch.object(main, "_notify_admin_activity"), \
             patch.object(main, "_alert_if_stale"):
            self.assertEqual(main.crawl(), 1)
        confirmations.assert_called_once_with(db)
        subscribers.assert_called_once_with(db, "kicpa:trainee", True)
        db.mark_removed.assert_called_once_with("kicpa:trainee", ["known"])
        db._request.assert_any_call("POST", "rpc/crawl_record_full_scan", json={"p_board": "trainee"})
        result = db.finish_run.call_args.kwargs
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["notified_count"], 2)
        self.assertIn("firms unavailable", result["error"])
