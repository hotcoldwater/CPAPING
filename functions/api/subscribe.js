/**
 * POST /api/subscribe — 은퇴했다 (2026-09-09).
 *
 * 메일만 구독하는 기능을 없애고 알림은 회원가입으로 받는다(운영자 결정).
 * 예전 화면이 캐시돼 있다가 부를 수 있어 410 과 안내를 돌려준다.
 * 확인·해지·조건 변경(/api/confirm, /api/unsubscribe, /api/settings)은 기존 구독자를
 * 위해 그대로 둔다.
 */
import { json } from "../_shared.js";

export async function onRequestPost() {
  return json({ error: "이제 회원가입으로 알림을 받습니다. https://cpaping.com/login/", gone: true }, 410);
}
