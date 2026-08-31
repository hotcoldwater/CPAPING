/**
 * 수신 거부. 알림 메일 하단의 링크와 메일 클라이언트의 해지 버튼이 쓴다.
 *
 * 개인정보처리방침 제3조·제4조에 따라 **상태만 바꾸지 않고 행을 삭제한다.**
 * 재가입 방지용 목록이나 이메일 해시도 남기지 않는다. 발송 이력은 외래키
 * cascade 로 함께 지워진다.
 *
 * GET  — 사람이 링크를 눌렀을 때. 안내 페이지를 보여준다
 * POST — RFC 8058 원클릭 해지. Gmail 등이 사용자 대신 호출한다
 */

import { supabase, page, SITE } from "../_shared.js";

/** 토큰에 해당하는 구독을 지운다. 지운 행 수를 돌려준다. */
async function removeByToken(env, token) {
  const rows = await supabase(
    env,
    `subscribers?unsubscribe_token=eq.${encodeURIComponent(token)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } }
  );
  return Array.isArray(rows) ? rows.length : 0;
}

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");

  if (!token) {
    return page({
      title: "링크가 올바르지 않습니다",
      lead: "수신 거부 링크가 잘못되었거나 잘려 있습니다.",
    });
  }

  try {
    const removed = await removeByToken(env, token);
    if (removed === 0) {
      // 이미 지워졌거나 없는 토큰. 둘 다 결과는 같으므로 같은 안내를 보여준다.
      return page({
        title: "이미 해지되었습니다",
        lead: "더 이상 알림 메일을 보내지 않습니다.",
      });
    }
    return page({
      title: "구독이 해지되었습니다",
      lead: "더 이상 알림 메일을 보내지 않습니다.",
      sub: "이메일 주소를 포함한 구독 정보를 모두 삭제했습니다.",
      linkText: "사이트로 돌아가기",
      href: SITE,
    });
  } catch (err) {
    console.error("해지 실패:", err.message);
    return page({
      title: "처리하지 못했습니다",
      lead: "잠시 후 링크를 다시 눌러 주세요.",
    });
  }
}

/**
 * 원클릭 해지(RFC 8058). 메일 클라이언트가 사용자 확인 없이 POST 한다.
 * 본문이나 응답 내용은 보지 않으므로 200 만 돌려주면 된다.
 */
export async function onRequestPost({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");
  if (token) {
    try {
      await removeByToken(env, token);
    } catch (err) {
      console.error("원클릭 해지 실패:", err.message);
      return new Response("error", { status: 500 });
    }
  }
  return new Response("unsubscribed", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
