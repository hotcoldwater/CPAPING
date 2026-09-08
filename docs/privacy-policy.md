# 개인정보처리방침 (확정본)

**운영자가 직접 작성한 본문이다. 법률 자문을 받지 않았다.**
`privacy-data-inventory.md` 는 자문에 쓰려고 만든 사실 정리이지만, 실제 자문으로
이어지지는 않았다. 이 파일이 원본이며,
`web/privacy.html` 이 이 내용을 게시한다. 내용을 고칠 때는 두 곳을 함께 바꾼다.

- 공고일 / 시행일: 2026년 9월 9일 (제7판)
- 게시 위치: https://cpaping.com/privacy

## 이 방침이 코드에 요구하는 것

방침에 적기만 하고 지키지 않으면 지키지 않는 약속이 된다. 아래는 구현으로
뒷받침되고 있다.

| 방침 조항 | 구현 |
|---|---|
| §3 확인하지 않은 신청은 7일 | `crawler/main.py` 의 `PENDING_RETENTION_DAYS`. 크롤 때마다 정리 |
| §3 해지자는 지체 없이 삭제 | `functions/api/unsubscribe.js` 가 행을 DELETE 한다 |
| §4 재가입 방지용 해시도 남기지 않음 | 삭제 시 아무것도 남기지 않는다 |
| §3 발송 이력은 함께 삭제 | `notification_logs` 의 외래키 cascade |
| §9 메일의 해지 링크 | 원클릭. `List-Unsubscribe` 헤더의 POST 도 처리한다 |
| §8 분석 도구 세 가지(Cloudflare·GA4·Clarity) 고지, 이메일 입력칸만 기록 제외, localStorage 3개 | `web/build.mjs` 의 `ANALYTICS`; 이메일 입력의 `data-clarity-mask` (그 외 화면은 기록됨 — 대시보드 마스킹 안 씀); `cpaping.filter`, `cpaping.sort`, `cpaping.region` |
| §5-1 모든 회원은 인증된 이메일 | `web/auth.js` 의 상태 계산 — `email` 과 `email_confirmed_at` 이 없으면 `/onboarding/` 에 묶인다 |
| §5-1 탈퇴 즉시 삭제 | `functions/api/account.js` 가 토큰의 주인만 admin API 로 삭제. `profiles` 는 cascade |
| §5-1 닉네임 규칙 | `007_profiles.sql` 의 CHECK(2~12자, 사칭 문구 금지) + `lower(nickname)` 유니크 |
| §5-1 동의 기록 | `auth.users.raw_user_meta_data.agreed_terms_at / over14` |
| §12 contact@cpaping.com | Cloudflare Email Routing 으로 수신 (설정 완료) |
| §6·§7 수탁자 목록 | 코드가 실제로 쓰는 서비스와 같아야 한다 |

## 변경 이력

**2026-09-09 제7판** — 로그인(Phase 3). §5-1 회원 계정 절 신설. 계정은 Supabase Auth, 우리는
닉네임만. 카카오는 이메일 없이 들어오므로 이메일 입력·인증을 강제한다(운영자 결정 8). 탈퇴는
`/api/account` DELETE — 토큰의 주인만 지운다. 게시물 익명화 존치는 댓글 Phase 에서 구현.
카카오는 국내 사업자라 §7(국외)에는 넣지 않고 §6(위탁)에만 적었다.


**2026-09-09 제6판** — 운영자가 Clarity 대시보드 마스킹을 **쓰지 않기로** 결정했다(녹화를
읽을 수 있어야 화면 개선에 쓸모가 있다). 제5판의 "입력 내용을 가려서 처리" 문구가 사실과
어긋나게 되어 §7·§8 을 "페이지 내용과 이용 과정이 기록된다, 이메일 입력칸만 제외" 로
바로잡았다. 이메일 입력칸의 `data-clarity-mask` 는 그대로 둔다 — 우리가 받는 유일한
개인정보가 이메일이라 그것만은 녹화에 남지 않아야 한다.


**2026-09-09 제5판** — Google Analytics 4 와 Microsoft Clarity 를 도입했다(운영자 결정).
둘 다 쿠키를 쓰고, Clarity 는 **세션 녹화** 도구라 지금까지의 "추적 쿠키 없음"
원칙에서 벗어나는 큰 변경이다. §6·§7 에 Google LLC·Microsoft Corporation 을 추가하고
§8 을 새로 썼다. 이메일 입력칸에는 `data-clarity-mask` 를 달았고 Clarity 대시보드의
Masking 은 Strict 로 두어야 한다. 지역 필터로 localStorage 가 3개가 됐다.
Functions 가 그리는 페이지(확인·해지·구독 설정)에는 분석 스니펫을 넣지 않는다 —
주소에 토큰이 실린다.


**2026-08-31 제3판** — 제12조의 개인정보 문의처를 `privacy@cpaping.com` 에서
`contact@cpaping.com` 으로 바꿨다. 서비스 문의 창구와 하나로 합쳤다. 창구가 둘이면
이용자가 어디로 보낼지 망설이고, 운영자도 두 곳을 확인해야 한다.

`privacy@` 라우팅은 지우지 않고 남겨 둔다. 짧게나마 공개됐던 주소라 그리로 오는
메일이 반송되면 안 된다.

**2026-08-31 제2판** — 알림 메일 발송을 Gmail(Google LLC) 에서 Resend 로 옮겼다.

Gmail SMTP 로 보내면 발신자에 운영자 개인 주소가 찍혀 모든 구독자에게 노출된다.
도메인 인증이 걸린 주소로 보내야 스팸함에도 덜 들어간다. 이에 따라 방침 §6·§7 에서
Google LLC 를 삭제했다. **수탁자가 한 곳 줄어들 뿐 새로 수집하는 정보는 없다.**

> ⚠️ 방침 전체가 자문을 거치지 않았다. 서비스가 커지거나 수집 항목이 늘면
> (계정 도입, 생년월일 수집, 분석 도구 추가 등) 한 번 확인받는 것이 안전하다.
> 관리자 장애 알림에는 Gmail SMTP 를 예비 경로로 남겨 두었으나, 이 경로에는
> 구독자 정보가 실리지 않으므로 수탁자에 해당하지 않는다고 보았다.

> `PENDING_RETENTION_DAYS` 를 바꾸면 방침 제3조도 함께 고쳐야 한다.

---

전체 본문은 `web/privacy.html` 에 있다.
