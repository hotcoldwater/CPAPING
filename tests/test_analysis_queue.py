import unittest
from unittest.mock import Mock,patch
from career import analysis_queue as q
from career import requirements_ai as ai

class QueueTests(unittest.TestCase):
 def setUp(self):
  self.db=Mock();self.db.rows.return_value=[];self.db.one.return_value={'id':42}
  self.job={'posting_id':42,'lease':'lease','attempts':1}
  self.result={'state':'classified'}
  self.env=patch.dict('os.environ',{'CAREER_RESUME_ENABLED':'true'});self.env.start();self.addCleanup(self.env.stop)
 def run_job(self,job=None,result=None,error=None,accepted=True):
  claimed=False
  def rpc(name,args=None):
   nonlocal claimed
   if name=='career_claim_analysis':
    if claimed:return []
    claimed=True;return [job or self.job]
   return accepted
  self.db.rpc.side_effect=rpc
  with patch('career.analysis_queue.analyze_once',return_value=(result or self.result,'source'),side_effect=error) as analyze,patch('career.resume_runner.match_new') as match,patch('career.resume_runner.prepare_pending') as prepare:
   count=q.process(self.db)
  return count,analyze,match,prepare
 def test_new_work_is_analyzed_and_waiting_applications_refreshed(self):
  count,analyze,match,prepare=self.run_job();self.assertEqual(count,1);analyze.assert_called_once();match.assert_called_once();prepare.assert_called_once_with(self.db,posting_id=42,original='source')
 def test_transient_failure_preserves_waiting_state_and_schedules_retry(self):
  count,_,_,prepare=self.run_job(error=TimeoutError());self.assertEqual(count,0);prepare.assert_not_called();args=[c.args[1] for c in self.db.rpc.call_args_list if c.args[0]=='career_finish_analysis'][0];self.assertIsNone(args['p_result']);self.assertIn('일시적인 오류',args['p_error'])
 def test_third_failure_allows_final_confirmation_and_no_infinite_retry(self):
  count,_,_,prepare=self.run_job(job={**self.job,'attempts':3},error=TimeoutError());self.assertEqual(count,1);prepare.assert_called_once()
 def test_expired_third_lease_is_finalized_without_fourth_ai_call(self):
  count,analyze,_,prepare=self.run_job(job={**self.job,'attempts':4});analyze.assert_not_called();self.assertEqual(count,1)
 def test_stale_analysis_never_updates_an_application(self):
  count,_,_,prepare=self.run_job(accepted=False);self.assertEqual(count,0);prepare.assert_not_called()
 def test_call_ai_can_make_one_attempt_for_persistent_queue_retry(self):
  with patch.dict('os.environ',{'KIMI_API_KEY':'fake'}),patch.object(ai.requests,'post',return_value=Mock(status_code=503,ok=False)) as send,patch.object(ai.time,'sleep'):
   with self.assertRaises(ValueError):ai.call_ai([],100,max_attempts=1)
   self.assertEqual(send.call_count,1)
 def test_completed_post_wakes_sender_before_next_analysis(self):
  events=[];jobs=[self.job,{**self.job,'posting_id':43},None]
  self.db.rpc.side_effect=lambda name,args=None: ([jobs.pop(0)] if jobs[0] else []) if name=='career_claim_analysis' else True
  self.db.rows.return_value=[]
  with patch('career.analysis_queue.analyze_once',side_effect=lambda p:(events.append('analyze') or (self.result,'source'))),patch('career.resume_runner.match_new'),patch('career.resume_runner.prepare_pending',side_effect=lambda *a,**kw:events.append('prepare')),patch('career.dispatch.wake_delivery',side_effect=lambda db:events.append('wake')):
   self.assertEqual(q.process(self.db),2)
  self.assertEqual(events,['analyze','prepare','wake','analyze','prepare','wake'])
