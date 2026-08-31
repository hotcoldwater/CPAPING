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
| §12 privacy@cpaping.com | **메일 수신 설정 필요** — Cloudflare Email Routing |

> `PENDING_RETENTION_DAYS` 를 바꾸면 방침 제3조도 함께 고쳐야 한다.

---

전체 본문은 `web/privacy.html` 에 있다.
