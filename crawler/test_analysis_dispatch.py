import unittest
from unittest.mock import Mock,patch
import analysis_dispatch as a
class DispatchTests(unittest.TestCase):
 def setUp(self):a._last_dispatch=0
 def test_only_pending_work_wakes_analysis_after_persistence(self):
  db=Mock();db._request.return_value=False
  with patch.dict('os.environ',{'GH_ANALYSIS_TOKEN':'fake','GITHUB_REPOSITORY':'owner/repo'}),patch.object(a.requests,'post') as post:
   self.assertFalse(a.dispatch_pending(db));post.assert_not_called()
   db._request.return_value=True
   self.assertTrue(a.dispatch_pending(db));self.assertIn('application-analysis.yml/dispatches',post.call_args.args[0]);self.assertEqual(post.call_args.kwargs['json'],{'ref':'main'})
 def test_failed_dispatch_leaves_durable_job_for_next_crawl(self):
  db=Mock();db._request.return_value=True
  with patch.dict('os.environ',{'GH_ANALYSIS_TOKEN':'fake','GITHUB_REPOSITORY':'owner/repo'}),patch.object(a.requests,'post',side_effect=TimeoutError()):
   self.assertFalse(a.dispatch_pending(db));self.assertEqual(db._request.call_count,1)
