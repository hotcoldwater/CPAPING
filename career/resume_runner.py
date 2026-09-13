"""완성된 이력서를 수정 없이 발송. AI·문서 생성 작업은 실행하지 않는다."""
import base64
import io
import logging
import os
import re
import zipfile
from datetime import datetime,timedelta,timezone
from dotenv import load_dotenv
from pypdf import PdfReader
from . import delivery,mail,matching
from .runtime import DB,digest,now,source
FLOW='uploaded-resume-v1'
log=logging.getLogger('resume')


def check_file(file):
    if not file or file.get('kind')!='resume':raise ValueError('업로드한 이력서를 선택해 주세요.')
    try:
        raw=base64.b64decode(file['data_base64'],validate=True)
        if not 8<=len(raw)<=3_000_000:raise ValueError()
        if file['mime']=='application/pdf':
            if not raw.startswith(b'%PDF-'):raise ValueError()
            pdf=PdfReader(io.BytesIO(raw))
            if pdf.is_encrypted or not len(pdf.pages):raise ValueError()
        elif file['mime']=='application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                infos=z.infolist();names={i.filename for i in infos}
                if len(infos)>2000 or sum(i.file_size for i in infos)>20_000_000 or any(i.flag_bits&1 for i in infos):raise ValueError()
                if not {'[Content_Types].xml','word/document.xml'}<=names or any('vbaproject' in n.lower() for n in names) or z.testzip():raise ValueError()
        else:raise ValueError()
    except Exception as e:raise ValueError('이력서를 열지 못했습니다. 암호 없는 정상 PDF 또는 Word(.docx)를 다시 업로드해 주세요.') from e
    return raw


def deadline_check(original):
    if re.search(r'(?:채용|모집|접수)\s*(?:이|가)?\s*(?:종료|완료)(?:되|됐|하|된|함|$)|(?:접수|모집|채용)\s*마감\s*(?:되었|됐|하였|완료)|채용완료|모집완료',original):raise ValueError('최신 공고에 채용 종료가 표시되어 있습니다.')
    kst=datetime.now(timezone(timedelta(hours=9)))
    for line in original.splitlines():
        if '마감' not in line:continue
        m=re.search(r'(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})',line)
        if m:
            try:date=datetime(*map(int,m.groups()),tzinfo=kst.tzinfo)
            except ValueError:raise ValueError('공고 마감일을 확인하지 못했습니다.')
            time=re.search(r'(\d{1,2})\s*[:시]\s*(\d{2})?',line[m.end():])
            if date.date()<kst.date():raise ValueError('최신 원문의 지원 마감일이 지났습니다.')
            if time and date.date()==kst.date():
                hour=int(time[1]);minute=int(time[2] or 0)
                if '오후' in line and hour<12:hour+=12
                if hour>23 or minute>59:raise ValueError('공고 마감 시각을 확인해 주세요.')
                if kst>=date.replace(hour=hour,minute=minute):raise ValueError('최신 원문의 지원 마감 시각이 지났습니다.')


def requirements(original,file):
    recipients=sorted({x.lower() for x in matching.EMAIL.findall(original)})
    reasons=[]
    if len(recipients)!=1:reasons.append('원문에서 지원 이메일을 하나로 확정할 수 없습니다.')
    if not re.search(r'자유\s*양식|양식\s*(?:자유|무관)',original) or '이력서' not in original:reasons.append('자유양식 이력서 제출 공고인지 확인이 필요합니다.')
    if not re.search(r'(?:이메일|이\s*메일|e-?mail)[^\n]{0,30}(?:지원|접수|제출|송부|발송)|(?:지원|접수|제출|송부|발송)[^\n]{0,30}(?:이메일|이\s*메일|e-?mail)',original,re.I):reasons.append('이메일 지원 방법을 확인해 주세요.')
    checks=[(r'(?:이메일|이\s*메일|e-?mail)[^\n]{0,40}(?:불가|금지)|우편|팩스|방문\s*(?:접수|지원)|전화\s*(?:접수|지원)', '이메일 외 지원 방법 또는 접수 제한을 확인해 주세요.'),
            (r'지정\s*양식|자사\s*양식|당사\s*양식|첨부\s*(?:양식|파일)|\.hwp|첨부 양식:', '지정 양식이나 별도 첨부파일을 확인해 주세요.'),
            (r'자기소개서|자소서|경력기술서|증명서|증빙|성적표|동의서|추천서|포트폴리오|사진|등본|초본|신분증|입사지원서|사본|스캔|자격증\s*(?:사본|스캔)', '추가 제출 서류가 있습니다. 업로드한 파일로 요건을 충족하는지 확인해 주세요.'),
            (r'제목|파일\s*명|압축|참조|\bCC\b|온라인|포털|홈페이지|사이트|지원\s*링크|(?:메일|이메일)[^\n]{0,15}(?:본문|내용)|본문[^\n]{0,30}(?:작성|기재|포함)', '메일 제목·파일명·지원 경로 등 별도 규칙을 확인해 주세요.'),
            (r'마감[^\n]{0,70}(?:\d{1,2}\s*:\s*\d{2}|\d{1,2}\s*시)', '마감 시각이 지정된 공고는 직접 검수해 주세요.')]
    # 추출 메타데이터의 '제목:'은 채용 공고 제목이며 메일 제목 규칙이 아니다.
    body='\n'.join(line for line in original.splitlines() if not line.startswith('제목:'))
    for pattern,reason in checks:
        if re.search(pattern,body,re.I):reasons.append(reason)
    if re.search(r'\bPDF\b',original,re.I) and file['mime']!='application/pdf':reasons.append('공고에 PDF가 언급되어 파일 형식 확인이 필요합니다.')
    if re.search(r'\b(?:DOCX|WORD)\b',original,re.I) and file['mime']=='application/pdf':reasons.append('공고에 Word가 언급되어 파일 형식 확인이 필요합니다.')
    return recipients,reasons


def message(template,rule,post):
    values={'이름':rule['applicant_name'],'법인':post.get('company_name') or '', '공고':post.get('title') or ''}
    return re.sub(r'\{(이름|법인|공고)\}',lambda m:values[m[1]],template)


def prepare(db,app):
    user=app['user_id'];rule=db.one('career_rules',user_id='eq.'+user)
    if not rule or not rule.get('resume_file_id'):raise ValueError('이력서와 지원 설정을 먼저 저장해 주세요.')
    file=db.one('career_files',id='eq.'+rule['resume_file_id'],user_id='eq.'+user);check_file(file)
    post=db.one('job_postings',id=f'eq.{app["posting_id"]}')
    if not post or not matching.is_open(post):raise ValueError('마감되거나 내려간 공고입니다.')
    account=db.one('career_mail_accounts',user_id='eq.'+user)
    if not account:raise ValueError('개인 Gmail을 먼저 연결해 주세요.')
    original=source(post);deadline_check(original);recipients,reasons=requirements(original,file)
    auto=bool(app['origin']=='rule' and rule['enabled'] and rule['mode']=='auto' and rule.get('consent_version')=='resume-auto-v1' and app['created_at']>=rule['enabled_since'] and not reasons)
    snapshot={'flow':FLOW,'company':post.get('company_name'),'title':post.get('title'),'detail_url':post.get('detail_url'),
              'source_hash':digest(original),'rule_updated_at':rule['updated_at'],'document_hash':digest(file['data_base64']),
              'sender_email':account['email'],'sender_connected_at':account['connected_at'],'allowed_recipients':recipients,'requirements':reasons,'auto':auto}
    subject=message(rule['mail_subject_template'],rule,post);body=message(rule['mail_body_template'],rule,post)
    if not subject or len(subject)>200 or re.search(r'[\r\n\x00-\x1f]',subject) or not body or len(body)>10000:raise ValueError('완성된 메일 제목·본문이 너무 길거나 잘못되었습니다. 설정을 수정해 주세요.')
    db.update('career_applications',{'snapshot':snapshot,'document_id':file['id'],'recipient':recipients[0] if len(recipients)==1 else None,
              'subject':subject,'body':body,'status':'queued' if auto else ('review' if recipients else 'blocked'),
              'approved_at':now() if auto else None,'reason':'\n'.join(reasons) or None,'version':app['version']+1,'updated_at':now()},
              id='eq.'+app['id'],user_id='eq.'+user,version=f'eq.{app["version"]}',status='eq.preparing')


def match_new(db):
    rules=db.all('career_rules',enabled='eq.true',resume_file_id='not.is.null',order='user_id.asc')
    if not rules:return
    posts=db.all('job_postings',first_seen_at='gt.'+min(r['enabled_since'] for r in rules),is_expired='eq.false',removed_at='is.null',order='id.asc')
    firms=db.all('firms',select='id,name,aliases',order='id.asc');byname={}
    for f in firms:
        for name in [f['name']]+(f.get('aliases') or []):byname[name]=f
    latest={}
    for f in db.all('firm_financials',select='firm_id,revenue,fiscal_year',order='fiscal_year.desc'):latest.setdefault(f['firm_id'],f)
    for rule in rules:
        for post in posts:
            firm=byname.get(post.get('company_name'))
            if not matching.matches(post,rule,firm,latest.get(firm['id']) if firm else None):continue
            if db.one('career_applications',user_id='eq.'+rule['user_id'],canonical_posting_id=f'eq.{post["id"]}',select='id'):continue
            try:db.insert('career_applications',{'user_id':rule['user_id'],'posting_id':post['id'],'canonical_posting_id':post['id'],'origin':'rule','snapshot':{'flow':FLOW}})
            except Exception:log.warning('지원 준비 등록 실패 또는 중복')


def send_one(db,app):
    user=app['user_id'];snap=app.get('snapshot',{})
    try:
        if snap.get('flow')!=FLOW:raise ValueError('지원 방식이 변경되었습니다.')
        rule=db.one('career_rules',user_id='eq.'+user)
        if not rule or rule.get('resume_file_id')!=app['document_id'] or rule['updated_at']!=snap.get('rule_updated_at'):raise ValueError('이력서나 설정이 변경되었습니다. 다시 준비해 주세요.')
        if snap.get('auto') and (not rule['enabled'] or rule['mode']!='auto' or rule.get('consent_version')!='resume-auto-v1'):raise ValueError('자동지원이 중지되거나 동의가 변경되었습니다.')
        if not snap.get('auto') and not snap.get('requirements_reviewed'):raise ValueError('공고와 첨부파일 검수가 필요합니다.')
        post=db.one('job_postings',id=f'eq.{app["posting_id"]}')
        if not post or not matching.is_open(post):raise ValueError('마감되거나 내려간 공고입니다.')
        original=source(post);deadline_check(original)
        if digest(original)!=snap.get('source_hash'):raise ValueError('공고 원문이 변경되었습니다. 다시 준비해 주세요.')
        if app.get('recipient') not in snap.get('allowed_recipients',[]) or app.get('recipient') not in {x.lower() for x in matching.EMAIL.findall(original)}:raise ValueError('최신 공고에서 지원 이메일을 확인하지 못했습니다.')
        file=db.one('career_files',id='eq.'+app['document_id'],user_id='eq.'+user);check_file(file)
        if digest(file['data_base64'])!=snap.get('document_hash'):raise ValueError('첨부파일이 변경되었습니다.')
        account=db.one('career_mail_accounts',user_id='eq.'+user)
        if not account or account['email']!=snap.get('sender_email') or account['connected_at']!=snap.get('sender_connected_at'):raise ValueError('발신 계정이 변경되거나 연결이 해제되었습니다.')
        # 네트워크 원문 조회 중의 설정 변경도 마지막에 재확인한다.
        fresh=db.one('career_rules',user_id='eq.'+user)
        current=db.one('career_applications',id='eq.'+app['id'],status='eq.sending',version=f'eq.{app["version"]}')
        if not fresh or fresh['updated_at']!=rule['updated_at'] or not current:raise ValueError('발송 직전 지원 상태가 변경되었습니다.')
        def refresh(value):db.update('career_mail_accounts',{'token_encrypted':value},user_id='eq.'+user,connected_at='eq.'+account['connected_at'])
        mid,_=delivery.deliver(db,{**app,'company':post.get('company_name') or '지원 법인'},account,file,refresh,mode='auto' if snap.get('auto') else 'review')
        db.update('career_applications',{'status':'sent','provider_message_id':mid,'sent_at':now(),'updated_at':now(),'reason':None},id='eq.'+app['id'],status='eq.sending')
    except mail.DeliveryUnknown:
        db.update('career_applications',{'status':'delivery_unknown','reason':'메일 접수 결과가 불명확합니다. 자동 재발송하지 않습니다.','updated_at':now()},id='eq.'+app['id'])
    except (ValueError,mail.MailError) as e:
        db.update('career_applications',{'status':'blocked','reason':str(e)[:800],'updated_at':now()},id='eq.'+app['id'])
    except Exception:
        db.update('career_applications',{'status':'delivery_unknown','reason':'발송 결과를 확인하지 못했습니다. 보낸편지함을 확인해 주세요.','updated_at':now()},id='eq.'+app['id'])


def main():
    load_dotenv();logging.basicConfig(level=logging.INFO)
    if os.getenv('CAREER_RESUME_ENABLED')!='true':return
    db=DB();cutoff=(datetime.now(timezone.utc)-timedelta(minutes=20)).isoformat()
    db.update('career_applications',{'status':'delivery_unknown','reason':'전송 처리가 중단됐습니다. 자동 재발송하지 않습니다.','updated_at':now()},status='eq.sending',updated_at='lt.'+cutoff,**{'snapshot->>flow':'eq.'+FLOW})
    db.update('career_mail_deliveries',{'status':'delivery_unknown','reason':'전송 접수 기록 갱신이 중단됐습니다.'},status='eq.sending',created_at='lt.'+cutoff)
    match_new(db)
    for app in db.rows('career_applications',status='eq.preparing',order='created_at.asc',limit=10,**{'snapshot->>flow':'eq.'+FLOW}):
        try:prepare(db,app)
        except Exception as e:
            reason=str(e)[:800] if isinstance(e,ValueError) else '지원 준비 중 오류가 발생했습니다. 다시 준비해 주세요.'
            db.update('career_applications',{'status':'blocked','reason':reason,'updated_at':now()},id='eq.'+app['id'],status='eq.preparing',version=f'eq.{app["version"]}')
    if os.getenv('CAREER_SEND_ENABLED')=='true':
        for _ in range(10):
            apps=db.rpc('career_claim_resume_send')
            if not apps:break
            send_one(db,apps[0])
    log.info('이력서 지원 처리 완료')

if __name__=='__main__':main()
