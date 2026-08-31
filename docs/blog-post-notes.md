# 블로그 글 작업 메모

붙여넣을 본문은 `blog-post.md` 에 있다. 이 파일은 그 옆에 두는 메모다.

## 제목 후보

1. **수습회계사 공고, 구인(CPA) 게시판만 보면 놓칩니다** ← 본문에 적용한 것
2. 한공회 수습 공고 한 달 치를 전부 뜯어봤습니다
3. 수습회계사 공고는 게시판이 따로 있습니다

1번은 읽기 전에 이미 하나를 알려주고 검색으로도 걸린다.

## 왜 이렇게 썼나

"서비스 소개" 로 쓰면 광고로 읽혀 퍼지지 않는다. 그래서 **데이터를 뜯어보다
알아낸 것을 공유하는 글**로 잡고 서비스는 뒤에 붙였다. 서비스를 안 쓰는 사람도
읽을 값이 있어야 공유된다.

가장 강한 재료는 **"게시판이 따로 있다"** 는 사실이다. 모르는 사람이 꽤 있을 것이다.

"안 하는 것" 을 길게 적은 이유는, 회계사 지망생이 이메일 수집에 민감할 것이고
먼저 밝히는 편이 신뢰를 얻기 때문이다.

## 올리기 전 확인

- [ ] 숫자를 오늘 값으로 갱신했는가 — 아래 명령으로 확인
- [ ] "오늘 마감 4건" 은 날짜가 지나면 틀린다. 당일에 올리거나 문장을 고칠 것
- [ ] 첫 문단에 본인 상황을 한 줄 넣었는가
      (예: "저도 올해 합격해서 지원 준비 중인데") — 신뢰가 크게 올라간다
- [ ] 한공회 게시판 링크가 살아 있는가

## 숫자 갱신용

```bash
cd ~/Projects/CPAPING && ./.venv/bin/python - <<'PY'
import json, urllib.request, collections, ssl, certifi, os
from dotenv import load_dotenv
load_dotenv('.env')
url = os.environ['SUPABASE_URL'] + "/rest/v1/job_postings?select=region,deadline,employment_type,is_target,is_expired&source=eq.kicpa:trainee"
req = urllib.request.Request(url, headers={"apikey": os.environ['SUPABASE_SECRET_KEY']})
d = json.load(urllib.request.urlopen(req, context=ssl.create_default_context(cafile=certifi.where())))
live = [r for r in d if r['is_target'] and not r['is_expired']]
print(f"전체 {len(d)}건 / 지원 가능 {len(live)}건")
print("지역:", dict(collections.Counter((r['region'] or '?').split()[0] for r in live)))
print("고용형태:", dict(collections.Counter(r['employment_type'] for r in live)))
print("마감일:", dict(sorted(collections.Counter(r['deadline'] for r in live).items())))
PY
```

## 커뮤니티 게시글용 짧은 버전

카페·오픈채팅에는 본문이 길다. 이 정도가 적당하다.

```
수습회계사 공고 알림 서비스 만들었습니다. cpaping.com

한공회 구인 게시판이 4개로 나뉘어 있는데, 수습·신입 공고는
'구인(수습CPA)' 라는 별도 게시판에 있습니다. 구인(CPA) 만 보면
경력·개업 공고만 나와서 놓치기 쉽습니다.

거기다 등록 1개월이 지나면 글이 자동 삭제돼서, 놓치면 찾을 방법이
없습니다. 지금도 오늘 마감인 게 4건이네요.

그래서 10분마다 확인해서 새 공고가 뜨면 메일로 보내주는 걸
만들었습니다. 이메일 주소만 받고, 해지는 메일 하단 링크 한 번입니다.
무료이고 광고 없습니다.

부족한 점 있으면 알려주세요.
```
