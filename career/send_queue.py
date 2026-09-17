"""Drain only approved mail; the database owns claims and duplicate protection."""
import logging,os,time
from dotenv import load_dotenv
from .runtime import DB
from .resume_runner import send_one
log=logging.getLogger('delivery')
def process(db,budget=240):
    if os.getenv('CAREER_RESUME_ENABLED')!='true' or os.getenv('CAREER_SEND_ENABLED')!='true':return 0
    began=time.monotonic();count=0
    while time.monotonic()-began<budget:
        apps=db.rpc('career_claim_resume_send')
        if not apps:break
        send_one(db,apps[0]);count+=1
    return count
def main():
    load_dotenv();logging.basicConfig(level=logging.INFO)
    if os.getenv('CAREER_RESUME_ENABLED')!='true' or os.getenv('CAREER_SEND_ENABLED')!='true':return
    log.info('승인된 발송 처리 %s건',process(DB()))
if __name__=='__main__':main()
