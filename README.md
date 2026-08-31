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

- KST 08~21시 — **10분** 간격
- 그 외 — **60분** 간격

### 스케줄러를 Cloudflare 로 옮긴 이유

GitHub Actions 의 `schedule` 은 실행을 보장하지 않는다. 실측한 결과가 이렇다.

```
설정: 하루 89회
실제: 3회 (19:11 → 22:33 → 01:17 UTC)
실행률 약 12%, 간격 2~3시간, 시각도 예약과 무관
```

공고를 빨리 확인하는 것이 이 서비스의 핵심이라 10분 간격은 타협할 수 없다.
그래서 **시계 역할만 Cloudflare Worker 가 맡고, 크롤러(Python)는 그대로
GitHub Actions 에서 돈다.** Worker 가 정시에 `workflow_dispatch` 를 호출하는데,
dispatch 로 띄운 실행은 큐에 걸리지 않고 즉시 시작한다(실측 20초 내 완료).

크롤러를 JS 로 다시 쓰지 않은 이유는, 검증된 파싱·분류 코드와 테스트를
그대로 두는 편이 위험이 적기 때문이다.

`crawl.yml` 의 `schedule` 은 예비로 남겨 둔다. 둘 다 떠도 워크플로의
`concurrency` 와 `notification_logs` 의 유니크 제약이 중복 발송을 막는다.

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

**담당자 개인정보는 수집하지 않는다.** 공고에는 담당자 이름과 개인 휴대폰 번호,
개인 이메일 주소가 적혀 있다. 게시판이 공개돼 있다고 해도 우리가 이를 따로
보관하고 알림 메일로 재배포할 이유가 없다. 지원자는 원문 링크에서 확인하면 된다.

---

## Phase 로드맵

| Phase | 내용 | 상태 |
|---|---|---|
| **0** | 리포 셋업 & README | ✅ 완료 |
| **1** | 크롤러 + DB + 관리자 알림 (MVP 코어) | ✅ 완료 |
| **2** | 공개 웹사이트 (공고 목록 + 이메일 구독) | 진행 중 |
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
**정적 HTML + 클라이언트 조회**로 간다. 공고가 월 14~17건인 단일 페이지라
Next.js 는 과하다고 보고, 로그인·마이페이지가 필요해지는 Phase 3 에서 옮긴다.

- `web/index.html` — 단일 반응형 페이지. Supabase 를 publishable key 로 직접 조회
- `web/build.mjs` — 플레이스홀더에 공개 키를 주입하고 자산을 `web/dist/` 로 복사 (의존성 없음)
- `web/make-og.py` — 공유 카드 이미지 생성 (Pillow, 내용을 바꿀 때만 실행)
- 고용형태 필터, 정렬 전환(**기본 최신순**), 등록일 표시
- 선택은 브라우저에 기억시켜 다음 방문에도 유지된다

**배지**

| 배지 | 뜻 |
|---|---|
| `NEW` | 처음 올라온 공고 (3일 이내) |
| `끌올 · 최초 MM.DD` | 같은 법인이 같은 자리를 다시 올린 것. 기간과 무관하게 계속 표시한다 |

한공회는 등록 1개월이 지난 글을 지운다. 채용이 안 된 법인은 같은 자리를 다시
올리는데, 지원자에게는 "새로 열린 자리" 와 "두 달째 안 채워지는 자리" 가 전혀
다른 정보다. 우리는 사라진 공고도 보존하므로 대조할 수 있다.

판정은 보수적으로 한다. 같은 법인이라도 연도나 본부 번호가 다르면 다른 자리로
본다. 새 자리를 끌올로 잘못 부르면 사용자가 "이미 본 거네" 하고 넘겨 기회를
놓치기 때문이다. **애매하면 최초 공고로 본다.**

> 끌올 판정에는 1개월 이상의 관측 이력이 필요하다. 수집을 2026-08-30 에
> 시작했으므로 실제 효과는 9월 말부터 나타난다.

**게시판에서 내려간 공고**

목록 하단에 접어서 보여준다. 지원 흐름을 방해하지 않으면서 기록은 남긴다.

내려간 이유는 세 가지인데 구분할 수 없다 — 채용이 됐거나, 마감일이 지났거나,
한공회가 1개월 뒤 자동으로 지웠거나. 그래서 "채용 완료" 라고 단정하지 않고
**"공고 내림"** 이라고만 적는다.
- `/privacy` — 개인정보처리방침 (법률 자문 확정본)

### 개인정보처리방침이 코드에 요구하는 것

방침에 적어만 두고 지키지 않으면 지키지 않는 약속이 된다. 아래는 구현으로
뒷받침한다. **방침을 고치면 이 표의 코드도 함께 고쳐야 한다.**

| 방침 조항 | 구현 |
|---|---|
| §3 확인하지 않은 신청은 7일 | `crawler/main.py` 의 `PENDING_RETENTION_DAYS`. 크롤마다 정리 |
| §3 해지자는 지체 없이 삭제 | `functions/api/unsubscribe.js` 가 행을 DELETE 한다 |
| §4 재가입 방지용 해시도 남기지 않음 | 삭제 시 아무것도 남기지 않는다 |
| §3 발송 이력은 함께 삭제 | `notification_logs` 의 외래키 cascade |
| §9 원클릭 해지 | GET(사람) 과 POST(RFC 8058 메일 클라이언트) 를 모두 처리 |
| §8 쿠키 없음, localStorage 2개 | `cpaping.filter`, `cpaping.sort` |
| §12 contact@cpaping.com | Cloudflare Email Routing 으로 수신. 서비스 문의와 같은 주소를 쓴다 |

**구독 (더블 옵트인)**

신청하면 `pending` 으로 저장하고 확인 메일을 보낸다. 링크를 눌러야 `active` 가
된다. 남의 주소를 함부로 등록하는 것을 막고 스팸 신고를 줄이기 위해서다.

브라우저에서 Supabase 로 직접 넣게 두면 공개 키만 알면 누구나 대량 등록할 수
있으므로, Cloudflare Pages Functions 로 서버를 한 겹 둔다. secret key 는
여기서만 쓰고 브라우저로 나가지 않는다.

```
POST /api/subscribe      { email, filter } → pending 저장 + 확인 메일
GET  /api/confirm?token  → active 로 변경
GET  /api/unsubscribe?token → 해지 (재확인 없이 한 번에)
```

발송 경로가 두 가지다.

| 경로 | 언제 | 비고 |
|---|---|---|
| Resend (HTTP) | 신청 즉시 | `RESEND_API_KEY` 가 있을 때. Workers 는 SMTP 를 못 쓴다 |
| Gmail SMTP (크롤러) | 다음 크롤 실행 때 | 위가 실패했거나 키가 없을 때 주워 담는다 |

구독 시점 **이후에 올라온 공고만** 보낸다. 갓 구독한 사람에게 기존 공고를
한꺼번에 보내면 스팸으로 보인다. 그건 사이트에서 보면 된다.

**공유 카드(OG)**: 카카오는 og:image 를 캐시하므로 `web/og.png` 의 경로를
함부로 바꾸지 않는다. 내용을 고쳤으면 카카오 디버거에서 캐시를 지워야 반영된다.

디자인은 **툴형** 으로 확정했다. 산세리프(IBM Plex Sans KR), 촘촘한 밀도,
마감 임박(D-7 이내) 빨강 강조, 라이트 온리. 근거는 `docs/stitch-prompt.md` 참고.

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
│   ├── schema.sql        # 테이블 + RLS
│   └── migrations/       # 스키마 변경 이력
├── functions/            # Cloudflare Pages Functions (리포 루트여야 한다)
│   ├── _shared.js
│   └── api/              #   subscribe · confirm · unsubscribe
├── worker/               # Cloudflare Worker — 크롤 트리거(시계 역할)
│   ├── wrangler.toml
│   └── src/index.js
├── web/
│   ├── index.html        # 공개 페이지 (플레이스홀더 포함)
│   ├── build.mjs         #   공개 키 주입 + 자산 복사 → dist/
│   ├── make-og.py        #   공유 카드 이미지 생성
│   └── og.png, favicon.* #   공유 카드와 파비콘
├── docs/
│   └── stitch-prompt.md  # 디자인 프롬프트와 톤 결정 근거
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

### 웹 페이지 미리보기

```bash
node web/build.mjs           # web/dist/index.html 생성
python -m http.server 8899 --directory web/dist
```

### DB 준비

Supabase SQL Editor 에서 `db/schema.sql` 을 한 번 실행한다.

### 크롤 트리거 Worker 배포

```bash
cd worker
npx wrangler login              # 브라우저에서 Cloudflare 로그인
npx wrangler secret put GITHUB_TOKEN   # Fine-grained PAT (Actions: read+write)
npx wrangler deploy
```

선택으로 트리거 실패 알림을 켜려면 `RESEND_API_KEY` 와 `ALERT_MAIL_TO` 도
`wrangler secret put` 으로 넣는다. 트리거가 실패하면 크롤러가 아예 돌지 않아
크롤러 쪽 장애 알림이 나갈 수 없기 때문에 따로 둔 것이다.

### GitHub Actions 시크릿

`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `CPAPING_MAIL_TO`,
`CPAPING_SMTP_USER`, `CPAPING_SMTP_APP_PASSWORD`

`MAIL_FROM` 은 Variables 든 Secrets 든 어느 쪽에 넣어도 된다. 둘 다 없으면
코드의 기본값 `CPAPING <noreply@cpaping.com>` 을 쓴다.

### 구독자 현황 보기

```bash
python crawler/subscribers.py          # 요약 (이메일 가림)
python crawler/subscribers.py --full   # 이메일 전체
```

Supabase 대시보드의 Table Editor > subscribers 에서도 같은 것을 볼 수 있다.
기본적으로 이메일을 가리는 이유는 대개 "몇 명인지" 만 알면 되기 때문이고,
방침 제10조의 "개인정보에 접근할 수 있는 기능의 최소화" 와도 같은 방향이다.

### 메일 발송 경로

| 대상 | 경로 | 이유 |
|---|---|---|
| 구독자 (확인·알림) | **Resend** | Gmail SMTP 로 보내면 발신자에 운영자 개인 주소가 찍혀 모든 구독자에게 노출된다. 도메인 인증(SPF·DKIM)이 걸린 주소라야 스팸함에도 덜 들어간다 |
| 관리자 장애 알림 | Resend → 실패 시 Gmail SMTP | Resend 가 죽으면 그 사실을 알릴 길이 없어진다. 이 경로에는 구독자 정보가 실리지 않으므로 방침의 수탁자와 무관하다 |

### 발송 한도

Resend 무료 티어는 **하루 100통, 월 3,000통, 초당 2건**이다. 공고 1건이 뜨면
구독자 수만큼 한꺼번에 나가므로 구독자가 늘수록 빨리 부딪힌다.

| 구독자 | 공고 1건당 | 월 예상 | 상태 |
|---|---|---|---|
| 50명 | 50통 | 약 650통 | 여유 |
| 100명 | 100통 | 약 1,300통 | 하루 한도에 근접 |
| 200명 | 200통 | 약 2,600통 | 하루 한도 초과 |

`notify.py` 가 발송 간격을 0.6초로 벌리고 429 가 오면 재시도한다.
구독자가 `SUBSCRIBER_WARN_THRESHOLD`(70명)를 넘으면 크롤 로그에 경고가 남는다.
그때 유료 전환을 검토하면 된다.

모든 발신 메일에 `Reply-To: contact@cpaping.com` 을 넣는다. 답장이 곧 피드백이
되게 하려는 것이다. 사이트로 돌아와 주소를 찾을 필요가 없다.

---

## 필요한 외부 설정

| Phase | 직접 해야 할 일 |
|---|---|
| 1 | Supabase 프로젝트 생성 / Gmail 앱 비밀번호 발급 / GitHub Secrets 등록 |
| 2 | Cloudflare Pages 연결 / 도메인 / **Pages 환경변수에 `SUPABASE_SECRET_KEY` 추가** / Resend 계정(선택) |
| 3 | Google OAuth 클라이언트 / Kakao Developers 앱 등록 |
| 7 | `brew install poppler` (PDF 텍스트 추출) |
