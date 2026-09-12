import base64,unittest
from email import message_from_bytes,policy
from unittest.mock import patch,Mock
from career import mail,delivery

class DeliveryTest(unittest.TestCase):
 def setUp(self):
  self.app={'id':'fake-id','version':2,'recipient':'recipient@example.com','subject':'제목','body':'내용 <script>test</script>','company':'법인'}
  self.account={'user_id':'owner','provider':'google','email':'sender@example.com'}
  self.file={'id':'file-id','name':'지원서.docx','mime':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','data_base64':base64.b64encode(b'docx').decode()}
 def test_html_pixel_preserves_plaintext_and_attachment(self):
  raw=mail.mime_message({**self.app,'tracking_url':'https://cpaping.com/api/mail-open/'+'a'*43+'.gif'},self.account,self.file);m=message_from_bytes(raw,policy=policy.default)
  self.assertEqual(m.get_body(preferencelist=('plain',)).get_content().strip(),self.app['body'])
  html=m.get_body(preferencelist=('html',)).get_content();self.assertIn('&lt;script&gt;',html);self.assertNotIn('<script>',html);self.assertEqual(html.count('<img'),1);self.assertEqual(len(list(m.iter_attachments())),1)
 def test_invalid_tracking_host_is_rejected(self):
  with self.assertRaises(mail.MailError):mail.mime_message({**self.app,'tracking_url':'https://evil.example/pixel'},self.account,self.file)
 def test_history_is_inserted_before_sending_and_updated_after(self):
  db=Mock();db.insert.return_value=[{'id':'delivery-id'}]
  with patch.object(mail,'send',return_value='provider-id') as send:
   result=delivery.deliver(db,self.app,self.account,self.file,lambda _:None)
   self.assertEqual(result,('provider-id','delivery-id'));self.assertEqual(db.insert.call_args.args[1]['application_version'],2);self.assertIn('tracking_url',send.call_args.args[0]);self.assertNotIn('tracking_url',db.insert.call_args.args[1]);self.assertEqual(db.update.call_args.args[1]['status'],'sent')
 def test_duplicate_history_error_never_sends(self):
  db=Mock();db.insert.side_effect=RuntimeError('duplicate')
  with patch.object(mail,'send') as send:
   with self.assertRaises(RuntimeError):delivery.deliver(db,self.app,self.account,self.file,lambda _:None)
   send.assert_not_called()
 def test_unknown_delivery_never_retries(self):
  db=Mock();db.insert.return_value=[{'id':'delivery-id'}]
  with patch.object(mail,'send',side_effect=mail.DeliveryUnknown('timeout')) as send:
   with self.assertRaises(mail.DeliveryUnknown):delivery.deliver(db,self.app,self.account,self.file,lambda _:None)
   self.assertEqual(send.call_count,1);self.assertEqual(db.update.call_args.args[1]['status'],'delivery_unknown')
if __name__=='__main__':unittest.main()
