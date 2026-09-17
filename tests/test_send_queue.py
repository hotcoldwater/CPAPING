import unittest
from unittest.mock import Mock,patch
from career import send_queue,dispatch
class FastSendTests(unittest.TestCase):
 def test_only_claimed_approved_items_are_sent_and_queue_drains_past_ten(self):
  db=Mock();db.rpc.side_effect=[[{'id':str(i)}] for i in range(12)]+[[]]
  with patch.dict('os.environ',{'CAREER_RESUME_ENABLED':'true','CAREER_SEND_ENABLED':'true'}),patch.object(send_queue,'send_one') as send:
   self.assertEqual(send_queue.process(db),12);self.assertEqual(send.call_count,12)
  self.assertTrue(all(c.args[0]=='career_claim_resume_send' for c in db.rpc.call_args_list))
 def test_disabled_sending_never_claims_work(self):
  db=Mock()
  with patch.dict('os.environ',{'CAREER_SEND_ENABLED':'false'}):self.assertEqual(send_queue.process(db),0)
  db.rpc.assert_not_called()
 def test_wake_failure_keeps_durable_approved_queue(self):
  db=Mock();db.rows.return_value=[{'id':'ready'}]
  with patch.dict('os.environ',{'GH_DELIVERY_TOKEN':'fake','GITHUB_REPOSITORY':'owner/repo','CAREER_SEND_ENABLED':'true'}),patch.object(dispatch,'_last',0),patch.object(dispatch.requests,'post',side_effect=TimeoutError()):self.assertFalse(dispatch.wake_delivery(db))
  db.update.assert_not_called();db.delete.assert_not_called()
 def test_no_work_never_dispatches(self):
  db=Mock();db.rows.return_value=[]
  with patch.dict('os.environ',{'GH_DELIVERY_TOKEN':'fake','GITHUB_REPOSITORY':'owner/repo','CAREER_SEND_ENABLED':'true'}),patch.object(dispatch,'_last',0),patch.object(dispatch.requests,'post') as post:
   self.assertFalse(dispatch.wake_delivery(db));post.assert_not_called()
