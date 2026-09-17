"""공개 공고 요건 분석, 승인 및 원본 지원서 파일 발송."""
import base64
import io
import logging
import os
import re
import zipfile
from datetime import datetime,timedelta,timezone
from dotenv import load_dotenv
from pypdf import PdfReader
from . import delivery,mail,matching,requirements_ai
from .runtime import DB,digest,now,source
FLOW='uploaded-resume-v1'
log=logging.getLogger('resume')


def check_file(file):
    if not file or file.get('kind') not in ('resume','attachment'):raise ValueError('업로드한 이력서를 선택해 주세요.')
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
        elif file.get('kind')=='attachment':
            ext=file['name'].rsplit('.',1)[-1].lower()
            if ext in ('hwp','doc','xls'):
                if not raw.startswith(bytes.fromhex('d0cf11e0a1b11ae1')):raise ValueError()
            elif ext in ('hwpx','xlsx'):
                with zipfile.ZipFile(io.BytesIO(raw)) as z:
                    if len(z.infolist())>2000 or sum(i.file_size for i in z.infolist())>20_000_000 or any('vbaproject' in i.filename.lower() or i.flag_bits&1 for i in z.infolist()) or z.testzip():raise ValueError()
                    if ext=='xlsx' and 'xl/workbook.xml' not in z.namelist():raise ValueError()
                    if ext=='hwpx' and 'Contents/content.hpf' not in z.namelist():raise ValueError()
            elif ext=='png':
                if not raw.startswith(bytes.fromhex('89504e470d0a1a0a')):raise ValueError()
            elif ext in ('jpg','jpeg'):
                if not raw.startswith(bytes.fromhex('ffd8ff')):raise ValueError()
            else:raise ValueError()
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
    # Compatibility helper; automatic decisions exclusively use requirements_ai.analyze.
    return sorted({x.lower() for x in matching.EMAIL.findall(original)}),['AI 분석이 필요합니다.']


def attachment(file,name=None):
    return {'id':file['id'],'name':name or file['name'],'mime':file['mime'],'hash':digest(file['data_base64'])}


def named_file(file,result,rule,post):
    if result.get('filename',{}).get('kind')!='designated':return file['name']
    stem=message(result['filename']['template'],rule,post)
    stem=re.sub(r'\.(?:pdf|docx)$','',stem,flags=re.I)
    if not stem or re.search(r'[\x00-\x1f/\\]',stem):raise ValueError('지정 파일명을 작성할 수 없습니다.')
    name=stem+('.pdf' if file['mime']=='application/pdf' else '.docx')
    if len(name)>200:raise ValueError('지정 파일명이 너무 깁니다.')
    return name


def message(template,rule,post):
    member=rule.get('member') or {}
    values={'이름':rule['applicant_name'],'법인':post.get('company_name') or '', '공고':post.get('title') or '', '출생년도':str(member.get('birth_date') or '')[:4], '합격년도':str(member.get('pass_year') or '')}
    def fill(m):
        key=m[1] or m[2]
        key='법인' if key=='회계법인' else key
        value=values[key]
        if not value:raise ValueError('지정 제목에 필요한 '+key+' 정보가 없습니다. 직접 작성해 주세요.')
        return value
    return re.sub(r'\[(회계법인|이름|공고)\]|\{(이름|법인|공고|출생년도|합격년도)\}',fill,template)


def initial_message(rule,post):
    from .routing import TEST_USER_ID,TEST_RECIPIENT
    snapshot={'flow':FLOW,'company':post.get('company_name'),'title':post.get('title'),'posting_ij_id':post.get('ij_id'),'detail_url':post.get('detail_url'),
              'test_recipient':TEST_RECIPIENT if rule.get('user_id')==TEST_USER_ID else None}
    subject=message(rule.get('mail_subject_template') or '[입사지원] [회계법인] - [이름]',rule,post)
    body=message(rule.get('mail_body_template') or '안녕하세요. [회계법인]에 지원하는 [이름]입니다.',rule,post)
    return {'subject':subject,'body':body,'snapshot':snapshot}


def prepare(db,app,original=None):
    user=app['user_id'];post=db.one('job_postings',id=f'eq.{app["posting_id"]}')
    result=(post or {}).get('application_analysis')
    if post and not requirements_ai.completed(result):
        db.rpc('career_enqueue_analysis',{'p_posting':post['id']})
        raise requirements_ai.AnalysisPending()
    rule=db.one('career_rules',user_id='eq.'+user)
    if not rule or not rule.get('resume_file_id'):raise ValueError('이력서와 지원 설정을 먼저 저장해 주세요.')
    if not post or not matching.is_open(post):raise ValueError('마감되거나 내려간 공고입니다.')
    if app['origin']=='rule' and not matching.resume_candidate(post,rule.get('filters') or {}):raise ValueError('자동지원은 선택한 풀타임·파트타임 신입·수습 공고만 가능합니다. 경력직은 대상이 아닙니다.')
    file=db.one('career_files',id='eq.'+rule['resume_file_id'],user_id='eq.'+user);check_file(file)
    account=db.one('career_mail_accounts',user_id='eq.'+user)
    if not account:raise ValueError('개인 Gmail을 먼저 연결해 주세요.')
    if result.get('state')=='needs_confirmation':
        original=original or post.get('body') or ''
    else:
        try:original=original if original is not None else source(post)
        except Exception:
            db.rpc('career_enqueue_analysis',{'p_posting':post['id'],'p_force':True})
            raise requirements_ai.AnalysisPending()
        if result.get('source_hash') and result['source_hash']!=digest(original):
            db.rpc('career_enqueue_analysis',{'p_posting':post['id'],'p_force':True})
            raise requirements_ai.AnalysisPending()
    deadline_check(original)
    reasons=requirements_ai.reasons(result)
    recipients=[result['recipient']] if result.get('recipient') else []
    if result.get('file_format')=='docx':
        docx=db.one('career_files',id='eq.'+rule['resume_docx_file_id'],user_id='eq.'+user) if rule.get('resume_docx_file_id') else None
        if docx:check_file(docx);file=docx
        else:reasons.append('Word(.docx) 지원서가 등록되지 않았습니다. 파일을 준비해 주세요.')
    if result.get('file_format')=='pdf' and file['mime']!='application/pdf':reasons.append('PDF 지원서가 등록되지 않았습니다.')
    rule['member']=db.one('member_details',user_id='eq.'+user) or {}
    try:filename=named_file(file,result,rule,post)
    except ValueError as e:filename=file['name'];reasons.append(str(e))
    auto=bool(app['origin']=='rule' and rule['enabled'] and rule['mode']=='auto' and rule.get('consent_version')=='resume-auto-v1' and app['created_at']>=rule['enabled_since'] and not reasons)
    from .routing import TEST_USER_ID,TEST_RECIPIENT
    snapshot={'test_recipient':TEST_RECIPIENT if user==TEST_USER_ID else None,'flow':FLOW,'company':post.get('company_name'),'title':post.get('title'),'detail_url':post.get('detail_url'),'posting_ij_id':post.get('ij_id'),
              'analysis':result,'attachments':[attachment(file,filename)],'source_hash':digest(original),'rule_updated_at':rule['updated_at'],'document_hash':digest(file['data_base64']),
              'sender_email':account['email'],'sender_connected_at':account['connected_at'],'allowed_recipients':recipients,'requirements':reasons,'auto':auto}
    subject=message(rule['mail_subject_template'],rule,post);body=message(rule['mail_body_template'],rule,post)
    if result.get('subject',{}).get('kind')=='designated':
        try:subject=message(result['subject']['template'],rule,post)
        except ValueError as e:reasons.append(str(e));auto=False
    if reasons:snapshot['auto']=False;auto=False
    if not subject or len(subject)>200 or re.search(r'[\r\n\x00-\x1f]',subject) or not body or len(body)>10000:raise ValueError('완성된 메일 제목·본문이 너무 길거나 잘못되었습니다. 설정을 수정해 주세요.')
    db.update('career_applications',{'snapshot':snapshot,'document_id':file['id'],'recipient':recipients[0] if len(recipients)==1 else None,
              'subject':subject,'body':body,'status':'blocked' if reasons or not recipients else ('queued' if auto else 'review'),
              'approved_at':now() if auto else None,'reason':'\n'.join(reasons) or None,'version':app['version']+1,'updated_at':now()},
              id='eq.'+app['id'],user_id='eq.'+user,version=f'eq.{app["version"]}',status='eq.preparing')


def match_new(db):
    rules=db.all('career_rules',enabled='eq.true',resume_file_id='not.is.null',order='user_id.asc')
    if not rules:return
    posts=db.all('job_postings',first_seen_at='gt.'+min(max(r['enabled_since'],r.get('history_since') or r['enabled_since']) for r in rules),is_expired='eq.false',removed_at='is.null',order='id.asc')
    for rule in rules:
        for post in posts:
            if not matching.matches_resume(post,rule):continue
            if db.one('career_applications',user_id='eq.'+rule['user_id'],canonical_posting_id=f'eq.{post["id"]}',select='id'):continue
            try:db.insert('career_applications',{'user_id':rule['user_id'],'posting_id':post['id'],'canonical_posting_id':post['id'],'origin':'rule',**initial_message(rule,post)})
            except Exception:log.warning('지원 준비 등록 실패 또는 중복')


def send_one(db,app):
    user=app['user_id'];snap=app.get('snapshot',{})
    try:
        if not snap.get('analysis') and not snap.get('manual_edit'):raise ValueError('AI 지원 요건 분석이 필요합니다. 현재 이력서로 다시 준비해 주세요.')
        if snap.get('flow')!=FLOW:raise ValueError('지원 방식이 변경되었습니다.')
        rule=db.one('career_rules',user_id='eq.'+user)
        if not rule or (not snap.get('manual_edit') and rule['updated_at']!=snap.get('rule_updated_at')):raise ValueError('이력서나 설정이 변경되었습니다. 다시 준비해 주세요.')
        if snap.get('auto') and (not rule['enabled'] or rule['mode']!='auto' or rule.get('consent_version')!='resume-auto-v1'):raise ValueError('자동지원이 중지되거나 동의가 변경되었습니다.')
        if not snap.get('auto') and not snap.get('requirements_reviewed'):raise ValueError('공고와 첨부파일 검수가 필요합니다.')
        post=db.one('job_postings',id=f'eq.{app["posting_id"]}')
        if not post or not matching.is_open(post):raise ValueError('마감되거나 내려간 공고입니다.')
        if (snap.get('auto') or (app.get('origin')=='rule' and not snap.get('manual_edit'))) and not matching.resume_candidate(post,rule.get('filters') or {}):raise ValueError('현재 공고는 선택한 풀타임·파트타임 신입·수습 자동지원 대상이 아닙니다.')
        if snap.get('analysis',{}).get('method')=='website':raise ValueError('사이트 접수 공고는 이메일로 발송할 수 없습니다.')
        original=source(post);deadline_check(original)
        if snap.get('analysis',{}).get('evidence_hash'):
            latest=requirements_ai.analyze(db,post,original,max_attempts=1,timeout_seconds=45)
            if latest.get('method')=='website':raise ValueError('지원 사이트에서 직접 접수해야 합니다.')
            if not snap.get('manual_edit') and (requirements_ai.reasons(latest) or latest.get('evidence_hash')!=snap['analysis']['evidence_hash']):raise ValueError('공고 또는 연결된 양식의 제출 요건이 변경되었습니다. 직접 확인해 주세요.')
        if not snap.get('manual_edit') and digest(original)!=snap.get('source_hash'):raise ValueError('공고 원문이 변경되었습니다. 다시 준비해 주세요.')
        if app.get('recipient') not in snap.get('allowed_recipients',[]) or app.get('recipient') not in {x.lower() for x in matching.EMAIL.findall(original)}:raise ValueError('최신 공고에서 지원 이메일을 확인하지 못했습니다.')
        manifest=snap.get('attachments') or [{'id':app['document_id'],'hash':snap.get('document_hash')}]
        if not 1<=len(manifest)<=5:raise ValueError('첨부파일은 1~5개가 필요합니다.')
        files=[]
        for entry in manifest:
            f=db.one('career_files',id='eq.'+entry['id'],user_id='eq.'+user);check_file(f)
            if digest(f['data_base64'])!=entry.get('hash'):raise ValueError('첨부파일이 변경되었습니다.')
            name=entry.get('name') or f['name']
            if re.search(r'[\r\n\x00-\x1f/\\]',name) or name.rsplit('.',1)[-1].lower()!=f['name'].rsplit('.',1)[-1].lower():raise ValueError('첨부파일명을 확인해 주세요.')
            files.append({**f,'name':name})
        if sum(len(f['data_base64']) for f in files)>12_000_000:raise ValueError('첨부파일 전체 크기는 9MB 이하여야 합니다.')
        account=db.one('career_mail_accounts',user_id='eq.'+user)
        if not account or account['email']!=snap.get('sender_email') or account['connected_at']!=snap.get('sender_connected_at'):raise ValueError('발신 계정이 변경되거나 연결이 해제되었습니다.')
        # 네트워크 원문 조회 중의 설정 변경도 마지막에 재확인한다.
        fresh=db.one('career_rules',user_id='eq.'+user)
        current=db.one('career_applications',id='eq.'+app['id'],status='eq.sending',version=f'eq.{app["version"]}')
        if not fresh or fresh['updated_at']!=rule['updated_at'] or not current:raise ValueError('발송 직전 지원 상태가 변경되었습니다.')
        def refresh(value):db.update('career_mail_accounts',{'token_encrypted':value},user_id='eq.'+user,connected_at='eq.'+account['connected_at'])
        mid,_=delivery.deliver(db,{**app,'company':post.get('company_name') or '지원 법인'},account,files,refresh,mode='auto' if snap.get('auto') else 'review')
        db.update('career_applications',{'status':'sent','provider_message_id':mid,'sent_at':now(),'updated_at':now(),'reason':None},id='eq.'+app['id'],status='eq.sending')
    except mail.DeliveryUnknown:
        db.update('career_applications',{'status':'delivery_unknown','reason':'메일 접수 결과가 불명확합니다. 자동 재발송하지 않습니다.','updated_at':now()},id='eq.'+app['id'])
    except (ValueError,mail.MailError) as e:
        db.update('career_applications',{'status':'blocked','reason':str(e)[:800],'updated_at':now()},id='eq.'+app['id'])
    except Exception:
        db.update('career_applications',{'status':'delivery_unknown','reason':'발송 결과를 확인하지 못했습니다. 보낸편지함을 확인해 주세요.','updated_at':now()},id='eq.'+app['id'])


def prepare_pending(db,posting_id=None,original=None):
    filters={'snapshot->>flow':'eq.'+FLOW}
    if posting_id is not None:filters['posting_id']='eq.'+str(posting_id)
    for app in db.rows('career_applications',status='eq.preparing',order='created_at.asc',limit=100,**filters):
        try:prepare(db,app,original=original)
        except requirements_ai.AnalysisPending:continue
        except Exception as e:
            reason=str(e)[:800] if isinstance(e,ValueError) else '지원 준비 중 오류가 발생했습니다. 다시 준비해 주세요.'
            db.update('career_applications',{'status':'blocked','reason':reason,'updated_at':now()},id='eq.'+app['id'],status='eq.preparing',version=f'eq.{app["version"]}')


def main():
    load_dotenv();logging.basicConfig(level=logging.INFO)
    if os.getenv('CAREER_RESUME_ENABLED')!='true':return
    db=DB();cutoff=(datetime.now(timezone.utc)-timedelta(minutes=20)).isoformat()
    db.update('career_applications',{'status':'delivery_unknown','reason':'전송 처리가 중단됐습니다. 자동 재발송하지 않습니다.','updated_at':now()},status='eq.sending',updated_at='lt.'+cutoff,**{'snapshot->>flow':'eq.'+FLOW})
    db.update('career_mail_deliveries',{'status':'delivery_unknown','reason':'전송 접수 기록 갱신이 중단됐습니다.'},status='eq.sending',created_at='lt.'+cutoff)
    match_new(db)
    prepare_pending(db)
    from .dispatch import wake_delivery
    wake_delivery(db)
    from . import review_notices
    try:review_notices.process(db)
    except Exception:log.warning('검수 안내 작업을 완료하지 못했습니다.')
    from . import failure_notices
    try:failure_notices.process(db)
    except Exception:log.warning('지원 실패 안내를 완료하지 못했습니다.')
    log.info('이력서 지원 처리 완료')

if __name__=='__main__':main()
