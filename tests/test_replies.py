import base64
import copy
import unittest
from unittest.mock import patch
from career import replies


def msg(mid, body, sender='hr@example.com', reference='<sent@example.com>', html=False):
    return {'id':mid,'threadId':'thread','internalDate':'2000','labelIds':['INBOX'], 'payload':{
        'mimeType':'text/html' if html else 'text/plain','body':{'data':base64.urlsafe_b64encode(body.encode()).decode()},
        'headers':[{'name':k,'value':v} for k,v in {'From':sender,'Subject':'전형 결과','In-Reply-To':reference,'Authentication-Results':'mx.google.com; dmarc=pass header.from=example.com'}.items()]}}

class ReplyTests(unittest.TestCase):
    def test_clear_results_and_receipt_are_distinct(self):
        cases={'서류전형에 합격하셨습니다.':'passed','서류 심사를 통과하셨습니다.':'passed','서류전형 결과: 불합격입니다.':'rejected','이번 채용에서는 함께하기 어렵습니다.':'rejected','지원서가 정상적으로 접수되었습니다.':'received',
               '지원서 접수 완료':'received','면접 일정을 알려드립니다.':'needs_review','서류전형 결과는 다음주 발표 예정입니다.':'needs_review','서류전형에 합격하시면 면접을 진행합니다.':'needs_review','서류전형 합격자에게만 연락합니다.':'needs_review','서류전형에 합격하지 못하셨습니다.':'needs_review','최종 면접 결과 불합격입니다.':'needs_review','서류전형에 합격하셨습니다. 서류전형 결과 불합격입니다.':'needs_review'}
        for value,expected in cases.items():
            with self.subTest(value=value):self.assertEqual(replies.classify('서류 합격',value),expected)
        self.assertEqual(replies.classify('서류전형에 합격하셨습니다.','확인 부탁드립니다.'),'needs_review')
    def test_quote_html_and_attachments_cannot_create_a_result(self):
        body='추가 서류를 보내주세요.\nOn yesterday HR wrote:\n서류전형에 합격하셨습니다.'
        self.assertEqual(replies.classify('',replies.plain_body(msg('1',body)['payload'])),'needs_review')
        payload=msg('1','<p>확인 부탁드립니다.</p><blockquote>서류전형에 합격하셨습니다.</blockquote><script>서류전형 결과 불합격입니다.</script><img src="https://tracker.example">',html=True)['payload']
        self.assertEqual(replies.plain_body(payload),'확인 부탁드립니다.')
        payload['filename']='attached.html';self.assertEqual(replies.plain_body(payload),'')
    def test_link_requires_real_reference_later_time_and_verified_recipient(self):
        original={'id':'sent','internalDate':'1000','payload':{'headers':[{'name':'Message-ID','value':'<sent@example.com>'}]}}
        delivery={'recipient':'hr@example.com'};account={'email':'me@example.com'}
        evidence=lambda m:replies.evidence(m,original,delivery,account)
        self.assertEqual(evidence(msg('reply','서류전형에 합격하셨습니다.'))['p_result'],'passed')
        self.assertIsNone(evidence(msg('reply','서류전형에 합격하셨습니다.',reference='<someone-else@example.com>')))
        self.assertIsNone(evidence(msg('reply','서류전형에 합격하셨습니다.',sender='me@example.com')))
        self.assertEqual(evidence(msg('reply','서류전형에 합격하셨습니다.',sender='other@example.com'))['p_result'],'needs_review')
        unsigned=msg('reply','서류전형에 합격하셨습니다.');unsigned['payload']['headers'].pop();self.assertEqual(evidence(unsigned)['p_result'],'needs_review')
        for label in ['SENT','DRAFT','SPAM','TRASH']:
            m=msg('reply','서류전형에 합격하셨습니다.');m['labelIds']=[label];self.assertIsNone(evidence(m))
        m=msg('reply','서류전형에 합격하셨습니다.');m['internalDate']='500';self.assertIsNone(evidence(m))
    def test_worker_records_against_sent_file_delivery_and_never_calls_send(self):
        class DB:
            def __init__(self):self.events=[];self.updates=[]
            def rpc(self,name,data):self.events.append((name,data))
            def update(self,*args,**kwargs):self.updates.append((args,kwargs))
        db=DB();account={'user_id':'owner','email':'me@example.com','connected_at':'timestamp'};delivery={'id':'delivery','provider_message_id':'sent','sender_email':'me@example.com','recipient':'hr@example.com','document_id':'old-resume'}
        original={'id':'sent','threadId':'thread','internalDate':'1000','payload':{'headers':[{'name':'Message-ID','value':'<sent@example.com>'}]}}
        with patch.object(replies,'gmail_get',side_effect=[original,{'messages':[msg('reply','서류전형에 합격하셨습니다.')]}]),patch.object(replies.mail,'send',side_effect=AssertionError('no sends')):
            replies.sync_delivery(db,account,delivery,'access')
        self.assertEqual(db.events[0][1]['p_delivery'],'delivery');self.assertEqual(db.events[0][1]['p_user'],'owner');self.assertEqual(db.events[0][1]['p_result'],'passed')
        with patch.object(replies,'gmail_get',side_effect=AssertionError('wrong account')):
            replies.sync_delivery(db,{**account,'email':'new@example.com'},delivery,'access')

if __name__=='__main__':unittest.main()
