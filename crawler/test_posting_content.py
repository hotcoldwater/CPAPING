import unittest
from unittest.mock import Mock
from bs4 import BeautifulSoup
from kicpa import Posting, parse_detail
from posting_content import extract_content
from store import Store, to_light_row, to_row

PAGE = '''<table class="table_st02"><tr><th>제목</th><td>테스트 모집</td></tr>
<tr><th>담당자</th><td>채용팀<a href="mailto:jobs@example.com">메일보내기</a></td><th>이메일</th><td>jobs@example.com</td></tr></table>
<table class="table_st02"><tr><td><pre>지원 방법\n이력서 제출</pre><p><strong>감사팀</strong> 모집</p>
<img src="/upload/채용 공고.png" onerror="bad()"><table><tr><th>직무</th><td colspan="2">감사</td></tr></table>
<a href="https://example.com/form.docx">지원서</a><a href="javascript:bad()">링크 설명</a>
<script>secret_attack()</script><iframe src="https://bad.example"></iframe><svg onload="bad()"></svg></td></tr></table>
<table class="table_st02"><tr><td><a onclick="fn_downloadFile('1','지정양식.hwp','mask')" href="#">다운로드</a></td></tr></table>'''

class ContentTests(unittest.TestCase):
    def test_preserves_nested_tables_images_lines_contacts_and_attachments(self):
        p=parse_detail(PAGE,Posting(ij_id='123'))
        self.assertIn('지원 방법\n이력서 제출',p.body)
        self.assertIn('감사',p.body)
        c=p.source_content
        self.assertEqual(c['version'],1)
        images=[n for n in c['nodes'] if isinstance(n,dict) and n['tag']=='img']
        self.assertTrue(images[0]['src'].startswith('https://www.kicpa.or.kr/upload/'))
        self.assertIn('%20',images[0]['src'])
        self.assertEqual(c['contacts'][0],{'label':'담당자','value':'채용팀'})
        self.assertEqual(c['attachments'],[{'name':'지원서','url':'https://example.com/form.docx'},{'name':'지정양식.hwp','url':None}])
        self.assertNotIn('secret_attack',str(c));self.assertNotIn('onerror',str(c))
        self.assertNotIn('javascript:',str(c));self.assertNotIn('iframe',str(c))

    def test_image_only_posting_and_empty_real_body(self):
        for markup in ['<img src="/poster.png">','']:
            c=extract_content(f'<table class="table_st02"><tr><td>{markup}</td></tr></table>','https://www.kicpa.or.kr/detail')
            self.assertEqual(c['version'],1)
        with self.assertRaises(ValueError):extract_content('<html>오류 화면</html>','https://www.kicpa.or.kr/')

    def test_dangerous_urls_and_attributes_are_not_retained(self):
        c=extract_content('<table class="table_st02"><tr><td><img src="data:image/svg+xml,bad"><a href="java&#10;script:alert(1)">글</a><p style="background:url(bad)" onclick="bad()">내용</p></td></tr></table>','https://www.kicpa.or.kr/')
        self.assertNotIn('data:',str(c));self.assertNotIn('onclick',str(c));self.assertNotIn('style',str(c))

    def test_list_updates_cannot_erase_source_content(self):
        p=parse_detail(PAGE,Posting(ij_id='123'))
        row=to_row(p);self.assertIsNotNone(row['content_fetched_at'])
        self.assertEqual(row['source_content'],p.source_content)
        self.assertNotIn('source_content',to_light_row(p));self.assertNotIn('body',to_light_row(p))

    def test_refresh_changes_only_document_fields_never_notification_state(self):
        db=Store(url='https://example.com',key='test');db._request=Mock(return_value=[])
        p=parse_detail(PAGE,Posting(ij_id='123'));db.update_content(p)
        args,kw=db._request.call_args
        self.assertEqual(args,('PATCH','job_postings'))
        self.assertEqual(set(kw['json']),{'body','source_content','content_fetched_at'})
        self.assertEqual(kw['params']['ij_id'],'eq.123')
        with self.assertRaises(ValueError):db.update_content(Posting(ij_id='123'))

if __name__ == '__main__':unittest.main()
