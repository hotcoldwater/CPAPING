# 개인정보처리방침 (확정본)

법률 자문을 거쳐 확정된 본문이다. **이 파일이 원본**이며,
`web/privacy.html` 이 이 내용을 게시한다. 내용을 고칠 때는 두 곳을 함께 바꾼다.

- 공고일 / 시행일: 2026년 8월 31일
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
| §8 쿠키 없음, localStorage 2개 | `cpaping.filter`, `cpaping.sort` |
| §12 privacy@cpaping.com | Cloudflare Email Routing 으로 수신 (설정 완료) |
| §6·§7 수탁자 목록 | 코드가 실제로 쓰는 서비스와 같아야 한다 |

## 변경 이력

**2026-08-31 제2판** — 알림 메일 발송을 Gmail(Google LLC) 에서 Resend 로 옮겼다.

Gmail SMTP 로 보내면 발신자에 운영자 개인 주소가 찍혀 모든 구독자에게 노출된다.
도메인 인증이 걸린 주소로 보내야 스팸함에도 덜 들어간다. 이에 따라 방침 §6·§7 에서
Google LLC 를 삭제했다. **수탁자가 한 곳 줄어들 뿐 새로 수집하는 정보는 없다.**

> ⚠️ 이 개정은 자문을 거치지 않았다. 다음 자문 때 확인받을 것.
> 관리자 장애 알림에는 Gmail SMTP 를 예비 경로로 남겨 두었으나, 이 경로에는
> 구독자 정보가 실리지 않으므로 수탁자에 해당하지 않는다고 보았다.

> `PENDING_RETENTION_DAYS` 를 바꾸면 방침 제3조도 함께 고쳐야 한다.

---

전체 본문은 `web/privacy.html` 에 있다.
