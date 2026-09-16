"""Shared qualification taxonomy for public browsing and new-posting notifications."""
import re
from types import SimpleNamespace

VERSION = 2
CPA = r'(?:공인\s*회계사(?!무소|회)|(?<![A-Za-z])(?:KI)?CPA(?![A-Za-z])|(?<!공인)회계사(?!무소|회))'
CPA_RE = re.compile(CPA, re.I)
PREFERRED = re.compile(CPA + r'[^\n.;。]{0,45}(?:우대|필수\s*아님|자격\s*(?:무관|불문))', re.I)
REQUIRED = re.compile(CPA + r'[^\n.;。]{0,45}(?:필수|자격\s*(?:소지|보유)|시험\s*합격|합격자|자격증\s*(?:소지|보유))', re.I)
STAFF = re.compile(r'기장|세무대리|경리|사무|행정|총무|비서|직원|담당자|인턴|연구원|상담|컨설턴트')
COMPANIES = {'1':'회계법인','2':'회계사무소','3':'공공기관','4':'일반기업','5':'헤드헌터','8':'한국공인회계사회'}


def qualification_sections(body):
    required, preferred = [], []
    mode = None
    for line in body.splitlines():
        if re.search(r'우대\s*(?:사항|조건|요건)|preferred\s*qualifications',line,re.I):mode='preferred'
        elif re.search(r'자격\s*요건|지원\s*자격|응시\s*자격|지원\s*요건|필수\s*요건|requirements|qualifications',line,re.I):mode='required'
        elif re.search(r'제출\s*서류|지원\s*방법|전형\s*절차|접수\s*방법|담당\s*업무|주요\s*업무|근무\s*조건|복리|연락처|회사\s*소개',line):mode=None
        if mode=='preferred':preferred.append(line)
        elif mode=='required':required.append(line)
    return '\n'.join(required), '\n'.join(preferred)


def taxonomy_row(p):
    p = SimpleNamespace(**{**dict.fromkeys(('title','body','career','board','company_name','co_sep','source_company_type','recruit_type','employment_type'), ''), 'source_categories': [], 'source_content': None, **vars(p)})
    title, body, career = p.title or '', p.body or '', p.career or ''
    categories = p.source_categories or (['trainee'] if p.board == 'trainee' else ['association'] if p.board == 'association' else [])
    company = p.co_sep or p.source_company_type or ''
    company = COMPANIES.get(company, company)
    if company not in COMPANIES.values():
        company = ('회계법인' if re.search(r'회[계게걔]법인', p.company_name or '') else
                   '한국공인회계사회' if p.company_name == '한국공인회계사회' else '확인 필요')
    clean_title = title.replace(p.company_name or '\x00', '')
    qualifications, preferences = qualification_sections(body)
    preferred = bool(PREFERRED.search(title+'\n'+body) or CPA_RE.search(preferences))
    # Qualification alternatives (e.g. CPA OR CFA) do not require a CPA license.
    alternatives = re.compile(CPA+r'[^\n]{0,15}(?:또는|혹은|\bor\b|/)[^\n]{0,15}(?:CFA|CTA|세무사|변호사|AICPA)',re.I)
    optional = bool(alternatives.search(qualifications))
    required_scope = PREFERRED.sub('', qualifications)
    required = bool(REQUIRED.search(PREFERRED.sub('',body.replace(preferences,''))) or CPA_RE.search(required_scope)) and not optional
    role_cpa = bool(CPA_RE.search(PREFERRED.sub('', clean_title)))
    is_cpa = required or role_cpa or 'trainee' in categories
    external_qualification = bool(re.search(r'(?:자격|요건)[^\n]{0,25}(?:첨부|참조)',body))
    general = not is_cpa and not external_qualification and bool(
        preferred or optional or STAFF.search(clean_title) or
        p.recruit_type in ('평직원','대리급','과장급','직원') or
        (qualifications and not CPA_RE.search(qualifications)) or
        ('general' in categories and STAFF.search(body)))
    mixed = is_cpa and bool(re.search(CPA+r'[^\n]{0,15}(?:및|와|/|,)\s*(?:일반\s*)?(?:직원|사무직)',clean_title,re.I))
    groups = []
    reasons = []
    if is_cpa:
        entry = bool(re.search(r'신입|수습|신규\s*회계사|시험\s*합격자', clean_title)) or career.strip()=='신입' or 'trainee' in categories
        any_career = bool(re.search(r'경력\s*(?:무관|불문)|신입\s*[·/ㆍ,및~ ]+\s*경력', clean_title+' '+career))
        # Title controls mixed/explicit recruitment; generic form defaults cannot override it.
        experienced = bool(re.search(r'경력(?!\s*(?:무관|불문))|(?<!\d)\d{1,2}\s*년\s*(?:이상|차)|파트너|개업|초빙|독립채산|참여\s*회계사|신규\s*설립', clean_title))
        minimum = re.search(r'([1-9]\d*)\s*(?:년|[~～-])',career)
        if minimum and not entry: experienced=True
        if not entry and not experienced:
            scope='\n'.join(x for x in body.splitlines() if re.search(r'자격|경력|신입|수습|지원\s*요건|대상|경험',x))
            entry = bool(re.search(r'신입|수습\s*(?:공인\s*)?회계사|시험\s*합격자',scope))
            experienced = bool(re.search(r'경력\s*\d+|\d+\s*년\s*이상|경력자|경험\s*\d+|(?:실무\s*)?수습[^\n]{0,20}(?:종료|완료)',scope))
            any_career = any_career or bool(re.search(r'경력\s*(?:무관|불문)',scope))
        any_career = any_career or (career.strip() in ('무관','경력무관','경력 무관') and not entry and not experienced)
        if re.search(CPA+r'[^\n]{0,70}(?:경력\s*무관|경력[^\n]{0,20}요건\s*미적용)', qualifications, re.I): entry=True
        if any_career and not experienced: entry=experienced=True
        if experienced and not re.search(r'신입|수습\s*(?:공인\s*)?회계사', clean_title) and re.search(r'경력[^\n]{0,12}채용|수습[^\n]{0,20}(?:종료|완료)', qualifications): entry=False
        if entry: groups.append('entry_cpa')
        if experienced: groups.append('experienced_cpa')
        reasons.append('CPA 모집 자격 확인' + (' · 경력 구분 확인 필요' if not groups else ''))
    if general or mixed:
        groups.append('general')
        reasons.append('CPA 우대, 필수 아님' if preferred else '일반 직원 모집')
    work=[]
    work_text=(p.employment_type or '')+' '+clean_title+' '+ ' '.join(x for x in body.splitlines() if re.search(r'근무\s*형태|고용\s*형태|채용\s*형태|계약\s*형태',x))
    for key,pattern in [('full_time',r'full\s*time|풀타임'),('part_time',r'part\s*time|파트\s*타임'),('internship',r'intern|인턴')]:
        if re.search(pattern,work_text,re.I): work.append(key)
    contracts=[key for key in ('정규직','계약직','전환형') if key in (p.employment_type or '')+' '+clean_title]
    names=' '.join(a.get('name','') for a in (p.source_content or {}).get('attachments',[]))
    form = ('designated' if re.search(r'입사\s*지원|지원서|이력서|자사\s*양식',names) or re.search(r'(?:지정|자사|첨부|당사)\s*양식',body)
            else 'free' if re.search(r'자유\s*양식',body) else 'unknown')
    methods=[]
    if re.search(r'이메일|e-?mail|메일로|[\w.+-]+@[\w.-]+\.[a-z]+',body,re.I) or any(x.get('label')=='이메일' for x in (p.source_content or {}).get('contacts',[])):methods.append('email')
    if re.search(r'온라인\s*(?:지원|접수)|홈페이지.*(?:지원|접수)|채용\s*(?:사이트|홈페이지)',body):methods.append('website')
    return dict(recruitment_categories=groups,company_type=company,
                source_categories=categories,source_company_type=p.source_company_type or p.co_sep or None,
                source_recruit_type=p.recruit_type or None,work_types=work,contract_types=contracts,
                cpa_preferred=preferred and not is_cpa,application_methods=methods,form_type=form,
                taxonomy_version=VERSION,taxonomy_needs_review=not groups,
                taxonomy_reason='; '.join(reasons) or '지원 자격 근거 확인 필요')
