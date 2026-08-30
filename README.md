# CPAPING

한국공인회계사회(한공회) 채용 게시판에 **회계법인 신입 공고**가 올라오면 즉시 이메일로 알려주는 서비스.

빅4에 가지 못해 로컬 회계법인을 지원하는 수험생·합격자가 공고를 놓치지 않도록 하는 것이 목표다.

---

## 서비스 개요

| | |
|---|---|
| **대상** | 로컬 회계법인 지원을 준비하는 수험생 / 합격자 |
| **핵심 기능** | 한공회 회계법인 공고 실시간 알림 |
| **확장 기능** | 회계법인 정보 DB, 자소서 작성 지원 |
| **웹사이트** | 미개설 (Cloudflare Pages 예정) |

### 동작 방식

```
한공회 게시판 폴링 (10분)
        ↓
  신규 공고 감지 (중복 제거)
        ↓
  자동 분류 (빅4 제외 / 신입 판정 / 직무 태깅)
        ↓
      DB 저장
        ↓
  조건 일치 구독자에게 이메일 발송
```

---

## MVP 범위

**빅4를 제외한 로컬 회계법인의 신입 채용 공고**만 다룬다.

- 법인 규모 세분류(대형로컬 / 중소형로컬)는 **Phase 5**로 미룬다
- 알림 채널은 **이메일만**. 카카오 알림톡은 Phase 6

### 분류 체계

| 축 | 값 | 적용 시점 |
|---|---|---|
| 법인 규모 | 빅4 / 대형로컬 / 중소형로컬 | Phase 5 (MVP는 빅4 제외만) |
| 직무 | 감사 / 딜 / 택스 / 기타 | Phase 1 |

빅4 = 삼일(PwC), 삼정(KPMG), 안진(Deloitte), 한영(EY)

### 수집 정보

이름, 이메일, 생년월일, 기합/유예 여부, (기합 시) 합격연도

> 전화번호는 수집하지 않는다.

---

## 기술 스택

| 영역 | 선택 |
|---|---|
| 크롤러 | Python 3 (`requests` + `beautifulsoup4` + `lxml`) |
| 크롤러 실행 | GitHub Actions cron |
| DB / 인증 | Supabase (Postgres + Auth) |
| 웹 | Next.js (static export) + Tailwind → Cloudflare Pages |
| 디자인 | Stitch 기반, 미니멀 |
| 메일 | Gmail SMTP (MVP) → Resend (확장) |
| 로그인 | 이메일 + Google + Kakao (Naver는 Phase 6) |

### 폴링 주기

상대 서버 부하를 배려해 업무 시간에만 촘촘히 조회한다.

- 평일 08~20시 — **10분** 간격
- 그 외 — **60분** 간격

---

## 크롤링 대상

한공회는 구인 게시판을 여러 개로 나눠 운영한다. **MVP 는 구인(수습CPA) 게시판만 본다.**

| 게시판 | 경로 | 성격 |
|---|---|---|
| **구인(수습CPA)** | `/home/jobOffrSrchNewGnrl/` | 한공회가 **수습회계사·시험 합격자 대상 공고만** 받도록 운영. 올라온 글이 곧 신입 공고다 |
| 구인(CPA) | `/home/jobOffrSrchGnrl/` | 경력·개업 위주. 코드는 지원하나 MVP 에서는 쓰지 않는다 |

```
https://www.kicpa.or.kr/home/jobOffrSrchNewGnrl/list.face?listCnt=50
https://www.kicpa.or.kr/home/jobOffrSrchNewGnrl/detail.face?ijIdNum=<id>
```

- 서버 렌더링 HTML — 헤드리스 브라우저 불필요
- 상세 페이지도 **GET 으로 접근 가능** (마감일·본문·담당자 확보)
- `robots.txt` 는 전체 허용(`Allow: /`)
- 목록 컬럼: 번호, 제목, 회사명, 지역, 구직완료 구분, 고용형태, 등록일자, 조회수

### 주의할 점

- **목록의 `번호`는 고정 ID 가 아니다.** 글이 삭제되면 밀리는 표시용 순번이라,
  중복 판정은 상세 조회 ID(`ijIdNum`)를 키로 쓴다.
- **등록 1개월이 지난 글은 한공회가 자동 삭제한다.** 놓치면 복구할 수 없으므로
  폴링이 끊기지 않아야 하고, 우리 DB 에서는 지우지 않고 `removed_at` 만 기록한다.
- 마감일이 지났는데 상태가 '채용중'인 공고가 실제로 있다. 마감일도 함께 검사한다.
- 게시판 컬럼 구성이 게시판마다 달라, 컬럼 위치를 고정하지 않고 **헤더를 읽어 매핑**한다.

공고 원문은 전재하지 않고 **요약 + 한공회 원문 링크**로 제공한다.

---

## Phase 로드맵

| Phase | 내용 | 상태 |
|---|---|---|
| **0** | 리포 셋업 & README | ✅ 완료 |
| **1** | 크롤러 + DB + 관리자 알림 (MVP 코어) | ✅ 완료 |
| **2** | 공개 웹사이트 (공고 목록 + 이메일 구독) | |
| **3** | 로그인 & 개인화 구독 설정 | |
| **4** | 회계법인 정보 DB | |
| **5** | 법인 규모 분류 도입 | |
| **6** | 알림 채널 확장 (카카오 알림톡, 네이버 로그인) | |
| **7** | 자소서 작성 지원 | |

### Phase 1 — 크롤러 + DB ✅
"신규 로컬 수습 공고가 뜨면 내 메일로 알림"이 동작한다.

목록 파싱 → 분류(빅4 제외 / 마감 판정 / 직무 태깅) → Supabase 저장 →
관리자 메일 → GitHub Actions cron → 장애 감지

상세 페이지는 **신규 공고만** 조회한다. 이미 아는 공고는 목록에서 보이는
값(조회수·구직완료 구분)만 갱신해 상대 서버 부담을 줄인다.

### Phase 2 — 공개 웹사이트
Next.js + Cloudflare Pages. 공고 목록, 직무·지역 필터, 로그인 없는 이메일 구독 폼.

### Phase 3 — 로그인 & 개인화
Supabase Auth(이메일/Google/Kakao), 온보딩, 구독 조건 설정, 원클릭 구독 해지, 개인정보처리방침.

### Phase 4 — 회계법인 정보 DB
전국 회계법인 리스트업, 법인별 페이지, 공고 ↔ 법인 자동 매칭.

### Phase 5 — 규모 분류
실제 데이터를 보고 대형로컬 기준을 확정(소속 회계사 수가 유력). 구독 필터에 규모 축 추가.

### Phase 6 — 채널 확장
카카오 알림톡(사업자등록 필요), Resend 전환, 네이버 로그인 커스텀 연동.

### Phase 7 — 자소서 작성 지원
`source/`의 면접 로드맵 PDF 기반. 경험 정리 → 페르소나 → 차별점 → 핵심질문 답변 → 자소서 초안.

---

## 디렉터리 구조

```
CPAPING/
├── crawler/              # 한공회 크롤러 (Python)
│   ├── kicpa.py          #   목록 수집 / 파싱
│   ├── classify.py       #   빅4 제외, 신입 판정, 직무 태깅
│   ├── store.py          #   Supabase 저장 + 중복 제거
│   ├── notify.py         #   이메일 발송
│   └── main.py           #   엔트리포인트
├── db/
│   └── schema.sql        # 테이블 + RLS
├── web/                  # Next.js 앱 (Phase 2~)
├── docs/                 # 조사 자료, 설계 메모
├── source/               # 자소서/면접 원자료 (PDF, git 제외)
└── .github/workflows/
    └── crawl.yml         # cron 실행
```

---

## 로컬 실행

```bash
# 1. 환경변수 준비
cp .env.example .env && chmod 600 .env
#    .env 를 열어 값을 채운다

# 2. 가상환경 + 의존성
python3 -m venv .venv
source .venv/bin/activate
pip install -r crawler/requirements.txt

# 3. 크롤러 실행 (DB 저장 없이 파싱 결과만 확인)
python crawler/main.py --dry-run

# 4. 저장만 하고 메일은 생략
python crawler/main.py --no-mail

# 5. 실제 실행 (수집 → 저장 → 신규 건 메일)
python crawler/main.py

# 테스트
python crawler/test_classify.py
```

### DB 준비

Supabase SQL Editor 에서 `db/schema.sql` 을 한 번 실행한다.

### GitHub Actions 시크릿

`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CPAPING_SMTP_USER`,
`CPAPING_SMTP_APP_PASSWORD`, `CPAPING_MAIL_TO`

---

## 필요한 외부 설정

| Phase | 직접 해야 할 일 |
|---|---|
| 1 | Supabase 프로젝트 생성 / Gmail 앱 비밀번호 발급 / GitHub Secrets 등록 |
| 2 | Cloudflare Pages 연결 / 도메인 구매(선택) |
| 3 | Google OAuth 클라이언트 / Kakao Developers 앱 등록 |
| 7 | `brew install poppler` (PDF 텍스트 추출) |
