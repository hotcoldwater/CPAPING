"""Extract public recruitment content into a non-executable document tree."""
import re
from urllib.parse import urljoin, urlsplit, quote
from bs4 import BeautifulSoup, NavigableString, Comment

TAGS = {'p','div','span','br','strong','b','em','i','u','s','blockquote','pre',
        'h1','h2','h3','h4','h5','h6','ul','ol','li','table','thead','tbody','tfoot',
        'tr','td','th','a','img','hr'}
DROP = {'script','style','iframe','object','embed','form','input','button','svg','math','noscript'}
CONTACTS = {'담당자','직위','전화번호','이메일','팩스'}

def safe_url(raw, base, image=False):
    value = urljoin(base, str(raw or '').strip())
    if not value or re.search(r'[\x00-\x1f\x7f]', value):
        return None
    value = quote(value, safe=":/?#[]@!$&'()*+,;=%")
    try:
        parts = urlsplit(value)
        if parts.username or parts.password:
            return None
        if parts.scheme in {'http','https'} and parts.hostname:
            return 'https:' + value[5:] if image and parts.scheme == 'http' else value
        if not image and parts.scheme in {'mailto','tel'}:
            return value
    except ValueError:
        pass
    return None

def body_cell(soup):
    # Inner content tables may have th cells of their own; only inspect the outer table.
    for table in soup.select('table.table_st02'):
        if not any(th.find_parent('table') is table for th in table.find_all('th')):
            cell = next((td for td in table.find_all('td') if td.find_parent('table') is table), None)
            if cell is not None:
                return cell
    return None

def extract_content(soup, base):
    if isinstance(soup, str):
        soup = BeautifulSoup(soup, 'lxml')
    cell = body_cell(soup)
    if cell is None:
        # Do not turn an upstream error/login page into an empty successful snapshot.
        raise ValueError('채용 공고 본문 영역을 찾을 수 없습니다')
    budget = [0]
    def walk(node, depth=0):
        budget[0] += 1
        if budget[0] > 15000 or depth > 60:
            raise ValueError('공고 본문 구조가 허용 크기를 초과합니다')
        if isinstance(node, Comment): return []
        if isinstance(node, NavigableString):
            return [str(node)]
        tag = (node.name or '').lower()
        if tag in DROP: return []
        children = [item for child in node.children for item in walk(child, depth+1)]
        if tag not in TAGS: return children
        item = {'tag':tag}
        if tag == 'img':
            src = safe_url(node.get('src'), base, image=True) if node.get('src') else None
            if not src: return []
            item.update(src=src, alt=node.get('alt',''))
        elif tag == 'a':
            href = safe_url(node.get('href'), base) if node.get('href') else None
            if not href: return children
            item['href'] = href
        elif tag in {'td','th'}:
            for attr in ('colspan','rowspan'):
                val = str(node.get(attr,''))
                if val.isdigit() and 1 <= int(val) <= 50: item[attr] = int(val)
        if tag == 'ol' and str(node.get('start','')).isdigit(): item['start'] = int(node['start'])
        if children: item['children'] = children
        return [item]
    nodes = [item for child in cell.children for item in walk(child)]
    contacts = []
    for table in soup.select('table.table_st02'):
        for th in table.find_all('th'):
            if th.find_parent('table') is not table: continue
            label = th.get_text('',strip=True)
            if label not in CONTACTS: continue
            td = th.find_next_sibling('td')
            if td is None: continue
            value = ' '.join(str(t).strip() for t in td.find_all(string=True)
                             if t.strip() and not (t.parent.name == 'a' and t.parent.get('href','').lower().startswith('mailto:')))
            if value and value != '-': contacts.append({'label':label,'value':value})
    attachments = []
    seen = set()
    for a in soup.select('table.table_st02 a'):
        name = a.get_text(' ',strip=True)
        download = re.search(r"fn_downloadFile\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)", a.get('onclick',''))
        url = safe_url(a.get('href'), base) if a.get('href') else None
        if download:
            name = download.group(2) or name
            # KICPA's form submission needs its original page; never execute copied JS.
            url = None
        elif not (url and re.search(r'\.(pdf|docx?|hwp[x]?|xlsx?|zip|pptx?)(?:[?#]|$)',url,re.I)):
            continue
        key = (name,url)
        if name and key not in seen:
            seen.add(key);attachments.append({'name':name,'url':url})
    return {'version':1,'nodes':nodes,'contacts':contacts,'attachments':attachments}
