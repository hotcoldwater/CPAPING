# Gmail 연결 테스트 운영 준비 — 2026-09-13

운영 버전 `8179240`에서 분리한 배포다. 기존 자소서·자동지원 브랜치의 공고 재분류, 전체 공고 알림, 게시판 변경은 포함하지 않는다.

## 공개할 범위

- `/mail-connect/`: CPAPING 로그인 후 본인 Gmail 연결 상태 조회, Google 권한 동의, 연결 해제.
- Google redirect URI: `https://cpaping.com/api/career/mail-callback`.
- `CAREER_ENABLED=true`와 **`CAREER_MAIL_ONLY=true`**를 함께 설정한다. 서버는 상태 조회·메일 연결·해제 이외의 경로를 차단한다. Microsoft 연결도 이번 테스트에서는 차단한다.
- AI 작업, 문서 생성, 지원서 준비, 실제 지원 메일 발송은 불가하다. 작업 처리 워크플로를 이 배포에 포함하지 않는다.
- Google 앱의 테스트 사용자로 등록한 계정으로 연결한다. 운영용 Google 검증은 후속 단계다.

## 설정

Cloudflare Pages에 `GOOGLE_MAIL_CLIENT_ID`, `GOOGLE_MAIL_CLIENT_SECRET`, `MAIL_TOKEN_KEY`, `CAREER_ORIGIN=https://cpaping.com`, `CAREER_ENABLED=true`, `CAREER_MAIL_ONLY=true`, `CAREER_SEND_ENABLED=false`를 설정한다. 기존 Supabase 서버 설정을 유지한다.

암호화 키는 로컬 `.env`에 새로 생성한 32바이트 base64 값이며 다른 값으로 재생성하지 않는다. 향후 Actions를 열 때도 같은 값을 사용한다. 키·토큰의 실제 값은 문서나 Git에 보관하지 않는다. Kimi 잔액 확인·유료 호출은 이번 단계에서 하지 않는다.

## DB 적용

SQL 013은 구독 테이블에 기본 꺼짐인 두 필드를 추가하고 공고 분류 주석을 보완한다. 기존 공고를 재분류하거나 메일을 보내지 않는다. SQL 014는 비공개 작업공간 테이블 7개와 서버 전용 큐 함수를 만든다. SQL 015는 이번 배포에서 적용하지 않는다.

적용 전 원격 테이블 부재, `job_postings.id`의 bigint 형식, SQL 013 미적용 상태를 확인했다. Supabase 물리 백업 목록은 비어 있었다. 새 테이블에는 기존 사용자 데이터가 없으며, 013과 014를 하나의 트랜잭션에 묶어 실패 시 전체 변경을 되돌린다. 기존 데이터의 UPDATE/DELETE나 재분류를 실행하지 않는다. 변경 전 주석·스키마 정보와 적용 결과는 임시 로컬 작업 폴더에 보관한다.

## 검증

메일 전용 API 테스트는 비허용 기능 차단, 익명 접근 차단, 본인 정보만 조회, PKCE·브라우저 state 연결, 토큰 암호화, 콜백 주소, 연결 해제 시 토큰 삭제를 검사한다. 실제 Google 계정 동의는 사용자가 테스트 화면에서 수행한다. 실제 메일 수신·Kimi 품질 검증은 별도다.

연결 해제 시 CPAPING 저장 토큰과 일회용 state를 삭제하고 Google 권한 철회를 시도한다. Google 통신이 실패한 경우에도 로컬 연결은 삭제되므로, 필요하면 Google 계정의 연결된 앱에서 남은 권한을 직접 철회할 수 있다.
