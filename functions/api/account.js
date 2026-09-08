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

export async function onRequestDelete({ request, env }) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return new Response("unauthorized", { status: 401 });

  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const who = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${token}` },
  });
  if (!who.ok) return new Response("unauthorized", { status: 401 });
  const user = await who.json();
  if (!user?.id) return new Response("unauthorized", { status: 401 });

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
