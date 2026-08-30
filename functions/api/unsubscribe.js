/**
 * GET /api/unsubscribe?token=...
 *
 * 알림 메일 하단의 수신 거부 링크. 한 번 누르면 바로 해지된다.
 * 재확인 절차를 두면 스팸 신고로 이어지므로 묻지 않는다.
 */

import { supabase, page, SITE } from "../_shared.js";

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");

  if (!token) {
    return page({
      title: "링크가 올바르지 않습니다",
      lead: "수신 거부 링크가 잘못되었거나 잘려 있습니다.",
    });
  }

  try {
    const rows = await supabase(
      env,
      `subscribers?select=id,status&unsubscribe_token=eq.${encodeURIComponent(token)}`
    );
    const row = rows[0];

    if (!row || row.status === "unsubscribed") {
      return page({
        title: "이미 해지되었습니다",
        lead: "더 이상 알림 메일을 보내지 않습니다.",
      });
    }

    await supabase(env, `subscribers?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "unsubscribed",
        unsubscribed_at: new Date().toISOString(),
      }),
    });

    return page({
      title: "구독이 해지되었습니다",
      lead: "더 이상 알림 메일을 보내지 않습니다.",
      sub: "언제든 다시 구독하실 수 있습니다.",
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
