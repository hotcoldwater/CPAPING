import os
import unittest
from unittest.mock import patch
import notify
import main

class HealthcheckGraceTests(unittest.TestCase):
    @patch('notify.requests.get')
    def test_short_failure_does_not_signal_fail(self,get):
        with patch.dict(os.environ,{'HEALTHCHECK_PING_URL':'https://hc-ping.com/test','HEALTHCHECK_FAIL_FAST':'false'}):notify.ping_healthcheck(False)
        get.assert_not_called()
    @patch('notify.requests.get')
    def test_success_still_pings(self,get):
        with patch.dict(os.environ,{'HEALTHCHECK_PING_URL':'https://hc-ping.com/test'}):notify.ping_healthcheck(True)
        get.assert_called_once_with('https://hc-ping.com/test',timeout=10)
    @patch('notify.requests.get')
    def test_opt_in_immediate_failure(self,get):
        with patch.dict(os.environ,{'HEALTHCHECK_PING_URL':'https://hc-ping.com/test/','HEALTHCHECK_FAIL_FAST':'true'}):notify.ping_healthcheck(False)
        get.assert_called_once_with('https://hc-ping.com/test/fail',timeout=10)
    def test_without_external_monitor_immediate_alert_remains(self):
        with patch.dict(os.environ,{'HEALTHCHECK_PING_URL':''}):self.assertFalse(notify.healthcheck_uses_grace())
    def test_failure_keeps_exit_code_and_no_duplicate_admin_mail(self):
        with patch.dict(os.environ,{'HEALTHCHECK_PING_URL':'https://hc-ping.com/test','HEALTHCHECK_FAIL_FAST':'false'}),patch('sys.argv',['main']),patch('main.load_dotenv'),patch('main.crawl',side_effect=RuntimeError('transient')),patch('main.traceback.print_exc'),patch('notify.send_alert') as send,patch('notify.requests.get') as get:
            self.assertEqual(main.main(),1);send.assert_not_called();get.assert_not_called()
    def test_nonzero_board_code_does_not_signal_success(self):
        with patch('sys.argv',['main']),patch('main.load_dotenv'),patch('main.crawl',side_effect=[0,1]),patch('notify.ping_healthcheck') as ping:
            self.assertEqual(main.main(),1);ping.assert_called_once_with(ok=False)

if __name__=='__main__':unittest.main()
