/**
 * DELETE /api/account — 탈퇴.
 *
 * 브라우저는 자기 계정을 지울 권한이 없다(admin API). 그래서 요청에 실린
 * 사용자 토큰을 Supabase 에 확인해 "누구인지" 를 정하고, 그 사용자만 서버가
 * 지운다. 다른 사람의 id 를 보내도 소용없다 — id 는 토큰에서만 나온다.
 *
 * 약관 §10 · 방침: 계정·이메일은 즉시 삭제(auth.users → profiles cascade),
 * 댓글은 남기되 작성자를 "탈퇴한 사용자" 로 표시한다(댓글 Phase 에서 구현).
 */

import { requireUser, supabase } from "../_shared.js";

export async function onRequestDelete({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return new Response("unauthorized", { status: 401 });
  const base = env.SUPABASE_URL.replace(/\/$/, "");

  // 알림 구독도 함께 지운다 — 연결된 것(user_id)과 같은 이메일로 남은 예전 방식 구독 모두.
  // "탈퇴하면 이메일을 즉시 삭제한다" 는 약속이다.
  try {
    await supabase(env, `subscribers?user_id=eq.${user.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    if (user.email) {
      await supabase(env, `subscribers?email_normalized=eq.${encodeURIComponent(user.email.toLowerCase())}`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } });
    }
  } catch (err) {
    console.error("탈퇴 시 구독 삭제 실패:", err.message);   // 계정 삭제는 계속한다
  }

  const del = await fetch(`${base}/auth/v1/admin/users/${user.id}`, {
    method: "DELETE",
    headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}` },
  });
  if (!del.ok) {
    console.error("탈퇴 실패:", del.status, (await del.text()).slice(0, 200));
    return new Response("error", { status: 500 });
  }
  return new Response(null, { status: 204 });
}
