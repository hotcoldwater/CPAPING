/**
 * GET /api/confirm?token=...
 *
 * 확인 메일의 링크. 구독을 확정한다.
 * confirmed_at 을 남겨 두면, 이 시각 이후에 새로 올라온 공고만 보낼 수 있다.
 * 갓 구독한 사람에게 기존 공고 14건을 한꺼번에 보내지 않기 위해서다.
 */

import { supabase, page, SITE } from "../_shared.js";

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token");

  if (!token) {
    return page({
      title: "링크가 올바르지 않습니다",
      lead: "확인 링크가 잘못되었거나 잘려 있습니다.",
      sub: "메일의 링크를 다시 눌러 주세요.",
    });
  }

  try {
    const rows = await supabase(
      env,
      `subscribers?select=id,status&confirm_token=eq.${encodeURIComponent(token)}`
    );
    const row = rows[0];

    if (!row) {
      return page({
        title: "만료된 링크입니다",
        lead: "이미 사용했거나 더 이상 유효하지 않은 링크입니다.",
        sub: "구독을 원하시면 다시 신청해 주세요.",
        linkText: "다시 신청하기",
      });
    }

    if (row.status === "active") {
      return page({
        title: "이미 구독 중입니다",
        lead: "새 공고가 올라오면 메일로 알려드릴게요.",
      });
    }

    await supabase(env, `subscribers?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "active",
        confirmed_at: new Date().toISOString(),
      }),
    });

    return page({
      title: "구독이 확정되었습니다",
      lead: "새 공고가 올라오면 메일로 알려드릴게요.",
      sub: "지금 열린 공고는 사이트에서 바로 확인하실 수 있습니다.",
      href: SITE,
    });
  } catch (err) {
    console.error("구독 확정 실패:", err.message);
    return page({
      title: "처리하지 못했습니다",
      lead: "잠시 후 링크를 다시 눌러 주세요.",
    });
  }
}
