"""개인 지원 작업의 DB 접근과 최신 한공회 원문 조회."""
import argparse
import base64
import hashlib
import json
import logging
import os
import re
import sys
from datetime import datetime,timedelta,timezone
from pathlib import Path
from urllib.parse import urljoin,urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv


sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'crawler'))
from store import Store
import kicpa

log=logging.getLogger('career')


def now():return datetime.now(timezone.utc).isoformat()

def digest(value):return hashlib.sha256(value.encode()).hexdigest()


class DB:
    def __init__(self):self.store=Store()
    def rows(self,table,**params):return self.store._request('GET',table,params=params)
    def one(self,table,**params):return next(iter(self.rows(table,**params)),None)
    def insert(self,table,data):return self.store._request('POST',table,json=data,headers={'Prefer':'return=representation'})
    def update(self,table,data,**params):return self.store._request('PATCH',table,params=params,json=data,headers={'Prefer':'return=representation'})
    def delete(self,table,**params):return self.store._request('DELETE',table,params=params)
    def rpc(self,name,data=None):return self.store._request('POST','rpc/'+name,json=data or {})
    def all(self,table,**params):
        out=[];offset=0
        while True:
            batch=self.rows(table,**params,offset=offset,limit=500);out.extend(batch)
            if len(batch)<500:return out
            offset+=500


def source_bundle(post):
    """지원 시점의 한공회 원문만 확인. 공고가 가리키는 임의 URL에는 요청하지 않는다."""
    board=post['source'].split(':')[-1]
    if board not in kicpa.BOARDS:raise ValueError('이 출처의 자동지원은 아직 지원하지 않습니다.')
    session=kicpa.make_session()
    response=session.get(kicpa.detail_url(board),params={'ijIdNum':post['ij_id']},timeout=(10,30),allow_redirects=False)
    if response.status_code!=200:raise ValueError('최신 공고 원문을 확인하지 못했습니다.')
    if len(response.content)>2_000_000:raise ValueError('원문이 너무 커 직접 확인이 필요합니다.')
    response.encoding='utf-8';soup=BeautifulSoup(response.text,'lxml')
    parts=[];labels={'제목','회사명','마감일','고용형태','근무지역','경력','학력','이메일','지원방법','첨부파일'}
    for table in soup.select('table.table_st02'):
        if not table.find('th',recursive=False) and not any(th.get_text(strip=True) in labels for th in table.select(':scope > tbody > tr > th, :scope > tr > th')):
            td=table.find('td')
            if td:parts.append(td.get_text('\n',strip=True))
        else:
            for tr in table.select('tr'):
                cells=tr.find_all(['th','td'])
                for th,td in zip(cells,cells[1:]):
                    if th.name=='th' and td.name=='td' and th.get_text(strip=True) in labels:
                        
                        if td.get_text(' ',strip=True):parts.append(th.get_text(strip=True)+': '+td.get_text(' ',strip=True))
    if not parts or not any(post.get('company_name','') in p for p in parts):raise ValueError('공고의 법인과 원문이 일치하지 않습니다.')
    attachments=[]
    for a in soup.select('a[href]'):
        href=a.get('href','');label=a.get_text(' ',strip=True)
        url=urljoin(kicpa.detail_url(board),href);parsed=urlparse(url)
        if parsed.scheme=='https' and parsed.hostname in {'www.kicpa.or.kr','kicpa.or.kr'} and not parsed.username and not parsed.password and parsed.port in {None,443}:
            if any(ext in (label+' '+href).lower() for ext in ['.pdf','.docx']):
                attachments.append(url)
    form=soup.select_one('#downloadForm');count=0
    for a in soup.select('a[onclick]'):
        if 'download' not in a.get('onclick','').lower():continue
        count+=1;label=a.get_text(' ',strip=True)
        try:
            match=re.search(r"fn_downloadFile\('([^']*)',\s*'([^']*)',\s*'([^']*)'\)",a['onclick'])
            if not form or not match or count>3:raise ValueError()
            fid,name,mask=match.groups();url=urljoin(kicpa.detail_url(board),form['action']);u=urlparse(url)
            if u.scheme!='https' or u.hostname!='www.kicpa.or.kr' or not re.fullmatch(r'/home/[A-Za-z]+/download\.face',u.path):raise ValueError()
            with session.post(url,data={'fileId':fid,'fileNm':name,'fileMask':mask},headers={'Referer':response.url},timeout=(8,20),allow_redirects=False,stream=True) as attachment_response:
                if attachment_response.status_code!=200:raise ValueError()
                raw=attachment_response.raw.read(4_000_001)
                if len(raw)>4_000_000:raise ValueError()
                from .requirements_ai import extract
                content=extract(raw,attachment_response.headers.get('content-type',''),url)
                parts.append('첨부파일 내용: '+name+'\n'+content)
        except Exception:parts.append('읽지 못한 첨부: '+label)
    for a in soup.select('table.table_st02 a[href]'):
        url=urljoin(kicpa.detail_url(board),a.get('href',''))
        if url.startswith('https://') and not urlparse(url).hostname.endswith('kicpa.or.kr'):parts.append('연결 링크: '+url)
    parts.extend('첨부 양식: '+url for url in sorted(set(attachments)))
    text='\n'.join(parts)
    if len(text)>60000:raise ValueError('공고가 너무 길어 직접 검수가 필요합니다.')
    # 원문 마감일이 DB와 달라도 보내기 전에 확인할 수 있게 안정된 요건 본문을 해시.
    return text,sorted(set(attachments))[:3]


def source(post):return source_bundle(post)[0]

