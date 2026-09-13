"""필터와 발송 요건은 AI 판단과 별도로 검사한다."""
import re
from datetime import datetime, timezone, timedelta

EMAIL=re.compile(r'[A-Za-z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}')


def is_open(post):
    if post.get('removed_at') or post.get('is_expired'): return False
    if any(x in str(post.get('hiring_status') or '') for x in ('마감','종료','완료')): return False
    today=(datetime.now(timezone.utc)+timedelta(hours=9)).date().isoformat()
    return not post.get('deadline') or str(post['deadline'])>=today


def matches(post,rule,firm=None,financial=None):
    if not rule.get('enabled') or not is_open(post): return False
    if not post.get('first_seen_at') or post['first_seen_at']<=rule['enabled_since']: return False
    if post.get('original_id'): return False  # 이미 있던 공고 끌올을 신규 지원으로 삼지 않음
    f=rule.get('filters',{})
    if f.get('firms') and (not firm or str(firm['id']) not in f['firms']): return False
    if not f.get('firms') and not f.get('all_firms'): return False
    if f.get('regions') and (post.get('region_group') or 'any') not in f['regions']: return False
    if f.get('types') and post.get('posting_type') not in f['types']: return False
    if f.get('employment') and post.get('employment_type') not in f['employment']: return False
    years=f.get('experience_years')
    if years is not None:
        if post.get('career_min_years') is not None and years<post['career_min_years']: return False
        if post.get('career_max_years') is not None and years>post['career_max_years']: return False
    for bound,operator in [('revenue_min',lambda a,b:a<b),('revenue_max',lambda a,b:a>b)]:
        if f.get(bound) is not None:
            if not financial or financial.get('revenue') is None or operator(float(financial['revenue']),f[bound]): return False
    content=(str(post.get('title') or '')+' '+str(post.get('body') or '')).lower()
    if f.get('keywords') and not any(k.lower() in content for k in f['keywords']): return False
    if any(k.lower() in content for k in f.get('exclude',[])): return False
    return True


def recipient_from_source(candidate,evidence,source):
    """받는 주소는 최신 원문과 증거 양쪽에서 일치해야 한다."""
    if not isinstance(candidate,str) or not EMAIL.fullmatch(candidate) or '\n' in candidate or '\r' in candidate: return None
    addresses={x.lower() for x in EMAIL.findall(source)}
    if candidate.lower() not in addresses or not evidence or evidence not in source or candidate.lower() not in evidence.lower(): return None
    return candidate


def blockers(requirements,source,profile,template=False):
    missing=list(requirements.get('missing',[]))+list(requirements.get('uncertainty',[]))
    for k in ['subject_evidence','mail_body_evidence','template_evidence']:
        evidence=requirements.get(k)
        if evidence and evidence not in source:missing.append('제출 규칙의 원문 근거를 확인하지 못했습니다.')
    if re.search(r'마감[^\n]{0,60}(?:\d{1,2}\s*:\s*\d{2}|(?:오전|오후)\s*\d+|\d{1,2}시)',source):
        missing.append('마감 시각이 지정된 공고입니다. 원문에서 시각을 확인해 직접 지원해 주세요.')
    if not recipient_from_source(requirements.get('recipient'),requirements.get('recipient_evidence'),source): missing.append('원문에서 지원 이메일을 확정하지 못했습니다.')
    if not profile.get('identity',{}).get('full_name'): missing.append('이름을 입력해 주세요.')
    if not profile.get('essay'): missing.append('최종 자소서를 저장해 주세요.')
    if not profile.get('facts_confirmed'): missing.append('학력·경력·자소서의 사실 여부를 확인해 주세요.')
    if requirements.get('template_required') and not template: missing.append('공고의 지정 양식을 등록하고 항목 대응을 확인해 주세요.')
    if requirements.get('file_format')=='unknown': missing.append('제출 파일 형식을 확인하지 못했습니다.')
    # 증빙서류는 생성하지 않는다. 사용자 업로드를 통한 첨부 기능 전까지 보류.
    docs=' '.join(requirements.get('required_documents',[]))
    if re.search(r'증명서|증빙|성적표|동의서|추천서|사진|자격증\s*(사본|스캔)',docs): missing.append('별도 증빙서류가 필요합니다. 원문을 확인해 직접 지원해 주세요.')
    if re.search(r'\[확인 필요|\{\{|미입력|TODO',profile.get('essay','')): missing.append('최종 자소서의 미완성 항목을 채워 주세요.')
    return list(dict.fromkeys(missing))
