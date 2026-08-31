/**
 * POST /api/subscribe  { email, filter }
 *
 * 구독 신청을 받아 pending 으로 저장하고 확인 메일을 보낸다.
 * 링크를 눌러야 active 가 되는 더블 옵트인이다.
 */

import { supabase, json, token, normalizeEmail, sendMail, SITE } from "../_shared.js";

function confirmMail(url, unsubscribeUrl) {
  const text =
    `CPAPING 구독을 신청하셨습니다.\n\n` +
    `아래 링크를 눌러 구독을 확정해 주세요.\n${url}\n\n` +
    `본인이 신청한 것이 아니라면 이 메일을 무시하세요. ` +
    `링크를 누르지 않으면 아무 메일도 보내지 않습니다.\n` +
    `신청 후 7일 안에 확인하지 않으면 입력하신 주소는 자동으로 삭제됩니다.\n\n` +
    `바로 구독을 취소하려면: ${unsubscribeUrl}\n` +
    `개인정보처리방침: ${SITE}/privacy\n\n— CPAPING`;

  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;` +
    `max-width:600px;margin:0 auto;padding:28px;color:#101317">` +
    `<div style="font-size:15px;font-weight:600;margin-bottom:14px">구독을 확정해 주세요</div>` +
    `<p style="font-size:13.5px;color:#5B6472;line-height:1.7;margin:0 0 22px">` +
    `아래 버튼을 누르면 회계법인 수습 공고가 올라올 때마다 알려드립니다.</p>` +
    `<a href="${url}" style="display:inline-block;padding:11px 20px;background:#123A8A;` +
    `color:#fff;text-decoration:none;border-radius:4px;font-size:13.5px;font-weight:500">` +
    `구독 확정하기</a>` +
    `<p style="font-size:11.5px;color:#868D99;line-height:1.7;margin:26px 0 0">` +
    `본인이 신청한 것이 아니라면 이 메일을 무시하세요. 링크를 누르지 않으면 아무 메일도 보내지 않습니다. ` +
    `신청 후 7일 안에 확인하지 않으면 입력하신 주소는 자동으로 삭제됩니다.</p>` +
    `<p style="font-size:11.5px;color:#B0B5BD;margin:18px 0 0">CPAPING · ` +
    `<a href="${unsubscribeUrl}" style="color:#868D99">구독 취소</a> · ` +
    `<a href="${SITE}/privacy" style="color:#868D99">개인정보처리방침</a></p></div>`;

  return { text, html };
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }

  const parsed = normalizeEmail(body.email);
  if (!parsed) {
    return json({ error: "이메일 주소를 다시 확인해 주세요." }, 400);
  }

  const filter = ["all", "full", "part"].includes(body.filter) ? body.filter : "all";

  try {
    const existing = await supabase(
      env,
      `subscribers?select=id,status,confirm_token,unsubscribe_token&email_normalized=eq.${encodeURIComponent(parsed.normalized)}`
    );

    let row = existing[0];

    if (row?.status === "active") {
      // 이미 구독 중이라는 사실 자체가 남의 가입 여부를 알려주는 정보가 되지만,
      // 같은 사람이 다시 신청했을 때 아무 안내가 없으면 더 혼란스럽다.
      return json({ status: "already", message: "이미 구독 중인 주소입니다." });
    }

    if (row) {
      // pending 이거나 예전에 해지한 주소 — 새 토큰으로 다시 시작한다
      const confirm = token();
      await supabase(env, `subscribers?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "pending",
          confirm_token: confirm,
          employment_filter: filter,
          confirmation_sent_at: null,
          unsubscribed_at: null,
        }),
      });
      row = { ...row, confirm_token: confirm };
    } else {
      const created = await supabase(env, "subscribers", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          email: parsed.email,
          email_normalized: parsed.normalized,
          confirm_token: token(),
          unsubscribe_token: token(),
          employment_filter: filter,
        }),
      });
      row = created[0];
    }

    const url = `${SITE}/api/confirm?token=${row.confirm_token}`;
    const unsubscribeUrl = `${SITE}/api/unsubscribe?token=${row.unsubscribe_token}`;
    const mail = confirmMail(url, unsubscribeUrl);
    const sent = await sendMail(env, {
      to: parsed.email,
      // 대괄호로 시작하는 제목은 스팸 필터가 광고로 보기 쉽다.
      // 받는 사람이 무엇을 해야 하는지 제목에서 바로 알게 한다.
      subject: "CPAPING 구독을 완료하려면 링크를 눌러주세요",
      ...mail,
      // 확인 메일에도 해지 수단을 둔다. 확정만 하고 알림을 아직 못 받은
      // 사람은 이 메일 말고는 해지할 방법이 없다.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    if (sent) {
      await supabase(env, `subscribers?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ confirmation_sent_at: new Date().toISOString() }),
      });
    }
    // 보내지 못했어도 신청은 남는다. 크롤러가 다음 실행 때 대신 보낸다.

    return json({ status: "pending" });
  } catch (err) {
    console.error("구독 신청 실패:", err.message);
    return json({ error: "잠시 후 다시 시도해 주세요." }, 500);
  }
}
