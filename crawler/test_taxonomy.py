import unittest
from unittest.mock import patch
from kicpa import Posting,fetch_board_inventory,parse_association_list
from taxonomy import taxonomy_row
from classify import classify
from store import wanted_employment,SKIP,Store

class TaxonomyTests(unittest.TestCase):
 def row(self,title,**kw):return taxonomy_row(Posting(board='cpa',title=title,**kw))
 def test_categories(self):
  for title,expected in [('수습 회계사 모집',['entry_cpa']),('경력 CPA 3년 이상',['experienced_cpa']),('신입 및 경력 회계사 모집',['entry_cpa','experienced_cpa']),('회계사 경력 무관',['entry_cpa','experienced_cpa']),('기장 직원 모집',['general'])]:
   with self.subTest(title=title):self.assertEqual(self.row(title)['recruitment_categories'],expected)
 def test_optional_cpa_is_general(self):
  row=self.row('재무 담당자 모집',body='지원자격: 학사 이상\nCPA 자격증 소지자 우대')
  self.assertEqual(row['recruitment_categories'],['general']);self.assertTrue(row['cpa_preferred'])
 def test_preference_section_and_attachment_only(self):
  row=self.row('재무 담당자',body='자격요건\n- 학사 이상\n우대사항\n- KICPA 보유자')
  self.assertEqual(row['recruitment_categories'],['general']);self.assertTrue(row['cpa_preferred'])
  self.assertEqual(self.row('전문직원 모집',body='지원자격: 첨부 공고문 참조')['recruitment_categories'],[])
 def test_calendar_year_is_not_experience(self):
  self.assertEqual(self.row('2026년 신입 공인회계사 모집')['recruitment_categories'],['entry_cpa'])
 def test_bare_career_any_is_both_but_body_minimum_wins(self):
  self.assertEqual(self.row('회계사 모집',career='무관')['recruitment_categories'],['entry_cpa','experienced_cpa'])
  self.assertEqual(self.row('회계사 모집',career='무관',body='지원자격: 회계 경험 7년 이상')['recruitment_categories'],['experienced_cpa'])
 def test_completed_practical_training_is_not_entry(self):
  for body in ['자격요건: 공인회계사 실무수습 종료 후 실무경력 1년 이상', '자격요건: CPA 자격 보유자 중 수습 기간(2년)을 완료하신 분']:
   with self.subTest(body=body):self.assertNotIn('entry_cpa',self.row('공인회계사 채용',career='무관',body=body)['recruitment_categories'])
 def test_cpa_specific_exemption_keeps_entry_applicants(self):
  row=self.row('회계 담당자 채용',career='무관',body='자격요건\n경력: 결산 실무 경력 8년 이상\nKICPA: 결산 실무경력 요건 미적용 (경력 무관)\n근무조건\n수습기간 3개월')
  self.assertIn('entry_cpa',row['recruitment_categories'])
 def test_entry_notifications_include_mixed_and_exclude_experienced(self):
  self.assertTrue(classify(Posting(board='cpa',title='신입 및 경력 CPA 모집'))['is_target'])
  self.assertFalse(classify(Posting(board='cpa',title='경력 CPA 3년 이상'))['is_target'])
 def test_all_notification_reads_are_entry_scoped(self):
  db=Store.__new__(Store)
  with patch.object(db,'_request',return_value=[]) as request:
   db.unnotified_targets('kicpa:cpa',include_unknown=True)
   self.assertEqual(request.call_args.kwargs['params']['recruitment_categories'],'cs.{entry_cpa}')
   db.postings_for_subscriber('kicpa:cpa',{'id':1,'want_trainee_full':True,'want_trainee_part':True})
   self.assertEqual(request.call_args.kwargs['params']['recruitment_categories'],'cs.{entry_cpa}')
 def test_department_does_not_imply_qualification(self):
  self.assertEqual(self.row('Deal Advisory M&A 인력 채용')['recruitment_categories'],[])
 def test_company_and_contract_separate(self):
  row=self.row('수습 회계사 계약직',company_name='예시회계법인',employment_type='Full Time')
  self.assertEqual(row['company_type'],'회계법인');self.assertEqual(row['work_types'],['full_time']);self.assertEqual(row['contract_types'],['계약직'])
 def test_required_cpa(self):
  row=self.row('감사팀 경력 채용',body='지원자격: CPA 자격 필수',career='3년 이상')
  self.assertEqual(row['recruitment_categories'],['experienced_cpa'])
 def test_non_cpa_in_accounting_office_name(self):
  row=self.row('예시회계사무소 기장직원',company_name='예시회계사무소')
  self.assertEqual(row['recruitment_categories'],['general'])
 def test_expanded_cpa_tabs_do_not_expand_legacy_delivery_scope(self):
  p=Posting(board='cpa',title='경력 회계사',source_categories=['cpa'],source_company_type='회계법인')
  self.assertFalse(classify(p)['is_target'])
  p.source_categories=['general'];self.assertFalse(classify(p)['is_target'])
  p.source_company_type='일반기업';self.assertFalse(classify(p)['is_target'])
 def test_new_board_cannot_receive_legacy_notifications(self):
  self.assertIs(wanted_employment('kicpa:association',{'want_trainee_full':True,'want_career':True}),SKIP)
  self.assertFalse(classify(Posting(board='association',title='신입 CPA 채용'))['is_target'])
 def test_all_source_tabs_and_duplicates(self):
  calls=[]
  def fetch(session,**kw):
   calls.append(kw)
   return [Posting(board='cpa',ij_id=kw['co_sep'])],1
  with patch('kicpa.fetch_complete_list',side_effect=fetch):
   rows,count=fetch_board_inventory(None,board='cpa',delay=0)
  self.assertEqual(len(calls),12);self.assertEqual(count,6)
  self.assertTrue(all(p.source_categories==['cpa','general'] for p in rows))
  self.assertEqual({x['co_sep'] for x in calls},{'1','2','3','4','5','8'})
 def test_trainee_internships_included(self):
  with patch('kicpa.fetch_complete_list',return_value=([],0)) as fetch:
   self.assertEqual(fetch_board_inventory(None,delay=0),([],0))
  self.assertEqual([x.kwargs['emp_sep'] for x in fetch.call_args_list],['5','6','7'])
 def test_association_id_and_date(self):
  html='<table><tr><td>1</td><td><a onclick="ebList.readBulletin(\'jobInfoKicpa\',\'12345\')">직원 모집</a></td><td>2026.09.15</td></tr></table>'
  rows=parse_association_list(html)
  self.assertEqual(len(rows),1);self.assertEqual(rows[0].ij_id,'12345');self.assertIn('bltnNo=12345',rows[0].detail_url)

if __name__=='__main__':unittest.main()
