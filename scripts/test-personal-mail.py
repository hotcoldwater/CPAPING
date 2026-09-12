"""명시한 테스트 주소로 개인 OAuth 메일 1건 발송. 기본은 미리보기이며 --send가 필요하다."""
import argparse,base64,json,os,sys,uuid
from pathlib import Path
import requests
from dotenv import load_dotenv
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from career import documents,delivery

class DB:
 def request(self,method,table,data=None,**params):
  r=requests.request(method,os.environ['SUPABASE_URL'].rstrip('/')+'/rest/v1/'+table,params=params,json=data,
    headers={'apikey':os.environ['SUPABASE_SECRET_KEY'],'Authorization':'Bearer '+os.environ['SUPABASE_SECRET_KEY'],'Prefer':'return=representation'},timeout=30)
  if not r.ok:raise RuntimeError('Database request failed: '+table+' HTTP '+str(r.status_code))
  return r.json() if r.content else []
 def one(self,table,**params):return next(iter(self.request('GET',table,**params)),None)
 def insert(self,table,data):return self.request('POST',table,data)
 def update(self,table,data,**params):return self.request('PATCH',table,data,**params)

def main():
 p=argparse.ArgumentParser();p.add_argument('--sender',required=True);p.add_argument('--recipient',required=True);p.add_argument('--test-key',required=True);p.add_argument('--output',required=True);p.add_argument('--send',action='store_true');a=p.parse_args()
 load_dotenv(Path(__file__).resolve().parents[1]/'.env')
 subject='[CPAPING 테스트] 회계법인 입사지원 — 테스트 지원자'
 body='안녕하세요, 채용 담당자님.\n\nCPAPING 개인 메일 지원 기능을 확인하기 위한 테스트 지원서를 첨부합니다.\n첨부 문서의 지원자는 가상 인물이며, 실제 채용 지원이 아닙니다.\n\n이번 테스트는 개인 Gmail 발송, 첨부파일 열람, 지원현황의 읽음 추정 표시를 확인하기 위한 것입니다.\n메일을 열어 첨부파일이 정상적으로 보이는지 확인해 주시면 됩니다.\n\n감사합니다.\nCPAPING 테스트 지원자'
 profile={'identity':{'full_name':'테스트 지원자 (가상)','target_firm':'테스트 회계법인','target_role':'회계법인 지원 기능 검증'},'essay':'이 문서는 CPAPING 개인 메일 지원 기능 검증을 위한 가상 지원서입니다. 실제 학력·경력·자격을 주장하지 않으며 실제 채용에 지원하는 문서가 아닙니다. 개인 Gmail 계정에서 담당자 테스트 주소로 PDF 첨부파일이 정상 전달되는지 확인합니다.'}
 raw=documents.make(profile,'pdf',a.sender);out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(raw)
 if not a.send:
  print(json.dumps({'mode':'preview','from':a.sender,'to':a.recipient,'subject':subject,'body':body,'attachment':str(out)},ensure_ascii=False,indent=2));return
 db=DB();existing=db.one('career_mail_deliveries',test_key='eq.'+a.test_key,select='id,status,sent_at')
 if existing:print(json.dumps({'already_attempted':True,**existing}));return
 account=db.one('career_mail_accounts',provider='eq.google',email='eq.'+a.sender)
 if not account:raise RuntimeError('Connected sender account not found')
 user=account['user_id']
 if not db.one('career_profiles',user_id='eq.'+user,select='user_id'):db.insert('career_profiles',{'user_id':user,'data':{}})
 file=db.insert('career_files',{'user_id':user,'name':'CPAPING_테스트_입사지원서.pdf','mime':'application/pdf','data_base64':base64.b64encode(raw).decode(),'kind':'document'})[0]
 app={'id':str(uuid.uuid4()),'company':'테스트 회계법인','recipient':a.recipient,'subject':subject,'body':body}
 def refresh(value):db.update('career_mail_accounts',{'token_encrypted':value},user_id='eq.'+user,connected_at='eq.'+account['connected_at'])
 message_id,record=delivery.deliver(db,app,account,file,refresh,mode='test',test_key=a.test_key)
 print(json.dumps({'status':'sent','recipient':a.recipient,'provider_message_id':message_id,'delivery_id':record},ensure_ascii=False))

if __name__=='__main__':main()
