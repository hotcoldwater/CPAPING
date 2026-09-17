import base64,copy,unittest
from unittest.mock import Mock,patch
from email import message_from_bytes,policy
from career import requirements_ai as ai,routing,mail,delivery

class AnalysisTests(unittest.TestCase):
 def setUp(self):
  self.source='이메일 지원 hr@example.com 제목: 신입_{이름} 파일명: {이름}_지원서 Word(.docx) 제출'
  self.value={'subject':{'kind':'designated','template':'신입_{이름}','evidence':'제목: 신입_{이름}'},'filename':{'kind':'designated','template':'{이름}_지원서','evidence':'파일명: {이름}_지원서'},'documents':{'kind':'free','evidence':''},'method':'email','recipient':'hr@example.com','recipient_evidence':'이메일 지원 hr@example.com','apply_url':'','file_format':'docx','format_evidence':'Word(.docx) 제출','required_documents':['이력서'],'blockers':[],'uncertainty':[]}
 def test_grounded_templates_and_docx(self):
  result=ai.validate(self.value,self.source,[]);self.assertEqual(result['state'],'classified');self.assertEqual(ai.reasons(result),[])
 def test_missing_attachment_is_confirmation_not_free(self):
  result=ai.validate(self.value,self.source,['첨부파일 읽기 실패']);self.assertEqual(result['state'],'needs_confirmation');self.assertIn('첨부파일 읽기 실패',ai.reasons(result))
 def test_fabricated_recipient_or_evidence_and_unknown_tokens_rejected(self):
  for change in [{'recipient':'intruder@example.com'},{'subject':{'kind':'designated','template':'{전화번호}','evidence':'제목: 신입_{이름}'}},{'format_evidence':'PDF 금지'}]:
   with self.subTest(change=change),self.assertRaises(ValueError):ai.validate({**copy.deepcopy(self.value),**change},self.source,[])
 def test_site_and_designated_documents_are_blockers(self):
  result={**self.value,'method':'website','documents':{'kind':'designated'},'file_format':'unsupported'}
  self.assertEqual(len(ai.reasons(result)),3)
 def test_private_ip_rejected_before_network(self):
  with patch('career.requirements_ai.socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]),patch('career.requirements_ai.urllib3.HTTPSConnectionPool') as pool:
   with self.assertRaises(ValueError):ai.public_get('https://public.example/form')
   pool.assert_not_called()

class RoutingTests(unittest.TestCase):
 def setUp(self):
  self.app={'id':'app','user_id':routing.TEST_USER_ID,'recipient':'hr@example.com','subject':'지원','body':'등록된 내용','cc':'hr2@example.com','bcc':'hr3@example.com'}
  self.account={'user_id':routing.TEST_USER_ID,'email':'sender@gmail.com','provider':'google'}
  self.file={'id':'f','name':'resume.pdf','mime':'application/pdf','data_base64':base64.b64encode(b'%PDF-test').decode()}
 def test_all_modes_override_final_mime_and_exclude_cc_bcc(self):
  for mode in ['auto','review','manual','test']:
   with self.subTest(mode=mode),patch('career.mail.access',return_value='token'),patch('career.runtime.DB'),patch('career.mail.requests.post') as send:
    send.return_value=Mock(ok=True,status_code=200,content=b'{}');send.return_value.json.return_value={'id':'mid'}
    mail.send({**self.app,'mode':mode},self.account,self.file,lambda _:None)
    msg=message_from_bytes(base64.urlsafe_b64decode(send.call_args.kwargs['json']['raw']),policy=policy.default)
    self.assertEqual(msg['To'],routing.TEST_RECIPIENT);self.assertIsNone(msg['Cc']);self.assertIsNone(msg['Bcc']);self.assertEqual(len(list(msg.iter_attachments())),1)
 def test_login_resolution_matches_email_and_other_accounts_unaffected(self):
  db=Mock();db.store.url='https://auth.example';db.store.key='test'
  with patch('career.routing.requests.get') as get:
   get.return_value.json.return_value={'id':'u','email':routing.TEST_LOGIN}
   self.assertEqual(routing.resolve(db,{'user_id':'u'},'hr@example.com'),routing.TEST_RECIPIENT)
   get.return_value.json.return_value={'id':'u','email':'other@example.com'}
   self.assertEqual(routing.resolve(db,{'user_id':'u'},'hr@example.com'),'hr@example.com')
   get.side_effect=RuntimeError()
   with self.assertRaises(mail.MailError):routing.resolve(db,{'user_id':'u'},'hr@example.com')
 def test_history_records_intended_and_actual_and_each_attachment(self):
  db=Mock();db.insert.return_value=[{'id':'delivery'}]
  with patch('career.mail.send',return_value='mid'):
   delivery.deliver(db,{**self.app,'version':1,'company':'법인'},self.account,[self.file,{**self.file,'id':'f2','name':'evidence.pdf'}],lambda _:None)
  row=db.insert.call_args.args[1];self.assertEqual(row['recipient'],routing.TEST_RECIPIENT);self.assertEqual(row['intended_recipient'],'hr@example.com');self.assertEqual(len(row['attachments']),2)
