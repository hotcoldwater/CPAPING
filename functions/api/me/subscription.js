/**
 * 회원의 알림 구독.
 *
 *   GET    /api/me/subscription        → { active, employment_filter, region_filter }
 *   PUT    /api/me/subscription        { employment_filter, region_filter } → 켜기·조건 변경
 *   DELETE /api/me/subscription        → 끄기
 *
 * subscribers 는 비공개 테이블이라 브라우저가 직접 못 만진다. 서버가 사용자 토큰을
 * 확인하고 대신 쓴다. 이메일은 가입 과정에서 이미 인증됐으므로 확인 메일 없이
 * 바로 active 다. 같은 이메일로 예전 방식의 구독이 있으면 새로 만들지 않고 연결한다.
 */

import { requireUser, supabase, json, token } from "../../_shared.js";

const FILTERS = ["all", "full", "part"];
const REGIONS = ["all", "capital", "local"];

async function findRow(env, user) {
  const byUser = await supabase(env,
    `subscribers?select=id,status,employment_filter,region_filter,user_id&user_id=eq.${user.id}&limit=1`);
  if (byUser[0]) return byUser[0];
  if (!user.email) return null;
  const byEmail = await supabase(env,
    `subscribers?select=id,status,employment_filter,region_filter,user_id&email_normalized=eq.${encodeURIComponent(user.email.toLowerCase())}&limit=1`);
  return byEmail[0] || null;
}

export async function onRequestGet({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  try {
    const row = await findRow(env, user);
    if (!row) return json({ active: false });
    // 이메일로만 찾은 예전 구독이면 이 계정에 연결해 둔다
    if (!row.user_id) {
      await supabase(env, `subscribers?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: user.id }) });
    }
    return json({ active: row.status === "active", employment_filter: row.employment_filter,
                  region_filter: row.region_filter || "all", pending: row.status === "pending" });
  } catch (err) {
    console.error("구독 조회 실패:", err.message);
    return json({ error: "server" }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (!user.email || !user.email_confirmed_at) return json({ error: "email_required" }, 400);
  let body = {};
  try { body = await request.json(); } catch {}
  const employment_filter = FILTERS.includes(body.employment_filter) ? body.employment_filter : "all";
  const region_filter = REGIONS.includes(body.region_filter) ? body.region_filter : "all";

  try {
    const row = await findRow(env, user);
    const now = new Date().toISOString();
    if (row) {
      await supabase(env, `subscribers?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: user.id, status: "active", employment_filter, region_filter,
                               confirmed_at: row.status === "active" ? undefined : now,
                               confirmation_sent_at: now, unsubscribed_at: null }) });
    } else {
      await supabase(env, "subscribers", { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ email: user.email, email_normalized: user.email.toLowerCase(), user_id: user.id,
                               status: "active", confirm_token: token(), unsubscribe_token: token(),
                               employment_filter, region_filter, confirmation_sent_at: now, confirmed_at: now }) });
    }
    return json({ active: true, employment_filter, region_filter });
  } catch (err) {
    console.error("구독 저장 실패:", err.message);
    return json({ error: "server" }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: "unauthorized" }, 401);
  try {
    const row = await findRow(env, user);
    if (row) await supabase(env, `subscribers?id=eq.${row.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    return json({ active: false });
  } catch (err) {
    console.error("구독 해지 실패:", err.message);
    return json({ error: "server" }, 500);
  }
}
