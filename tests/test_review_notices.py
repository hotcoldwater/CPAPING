import copy, unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch
import requests
from career import review_notices as n, resume_runner as r

class NoticeTests(unittest.TestCase):
 def setUp(self):
  self.app={'id':'a','user_id':'u','status':'review','snapshot':{'company':'예시법인'}}
  self.notice={'application_id':'a','user_id':'u','status':'pending','payload':None,'claimed_at':None}
  self.db=Mock();self.db.one.side_effect=lambda table,**kw:self.app if table=='career_applications' else {'enabled':True}
  self.db.update.return_value=[self.notice]
 def test_invitation_link_does_not_include_resume_body_or_approve_action(self):
  p=n.invitation(self.app,'owner@example.com');self.assertIn('https://cpaping.com/applications/?review=a',p['text']);self.assertNotIn('approve',p['text']);self.assertEqual(p['to'],['owner@example.com'])
 def test_timeout_retries_same_saved_payload_and_idempotency_key(self):
  with patch.dict('os.environ',{'RESEND_API_KEY':'fake'}),patch.object(n,'verified_email',return_value='owner@example.com'),patch.object(n.requests,'post',side_effect=requests.Timeout) as send:
   n.deliver_notice(self.db,self.notice)
   saved=copy.deepcopy(self.db.update.call_args_list[0].args[1]);first=copy.deepcopy(send.call_args.kwargs)
   self.assertEqual(self.db.update.call_args.args[1]['status'],'pending')
   self.app['snapshot']['company']='changed';n.deliver_notice(self.db,{**self.notice,**saved,'status':'pending'})
   self.assertEqual(send.call_args.kwargs['json'],first['json']);self.assertEqual(send.call_args.kwargs['headers']['Idempotency-Key'],first['headers']['Idempotency-Key'])
 def test_expired_idempotency_window_never_resends(self):
  self.notice['claimed_at']=(datetime.now(timezone.utc)-timedelta(hours=24)).isoformat()
  with patch.object(n.requests,'post') as send:n.deliver_notice(self.db,self.notice);send.assert_not_called()
  self.assertEqual(self.db.update.call_args.args[1]['status'],'unknown')
 def test_cancelled_application_never_sends_and_lost_claim_does_not_send(self):
  self.app['status']='cancelled'
  with patch.object(n.requests,'post') as send:n.deliver_notice(self.db,self.notice);send.assert_not_called()
  self.app['status']='review';self.db.update.return_value=[]
  with patch.object(n,'verified_email',return_value='owner@example.com'),patch.object(n.requests,'post') as send:n.deliver_notice(self.db,self.notice);send.assert_not_called()
 def test_both_subject_and_body_support_firm_token_without_recursion(self):
  for template in ['[입사지원] [회계법인] - {이름}','[회계법인] 지원. {법인}. {공고}']:
   text=r.message(template,{'applicant_name':'지원자'},{'company_name':'예시법인','title':'채용'});self.assertIn('예시법인',text);self.assertNotIn('[회계법인]',text)
  self.assertEqual(r.message('[회계법인]',{'applicant_name':'지원자'},{'company_name':'{이름}'}),'{이름}')
if __name__=='__main__':unittest.main()
