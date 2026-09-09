/**
 * 댓글 (Phase 5). 공고·법인·게시판이 같은 코드를 쓴다 —
 * <section id="comments" data-target-type="posting|firm|post" data-target-id="…"> 만 다르다.
 *
 * 읽기는 누구나(공개 뷰를 fetch 로), 쓰기는 가입을 마친 회원만.
 * 추천: 한 사람이 한 댓글에 한 번, 다시 누르면 취소. 비추천은 없다.
 * 베스트: 추천 BEST_MIN 개 이상인 원댓글 중 상위 BEST_MAX 개를 맨 위에 고정한다.
 *         원래 자리에도 그대로 남겨 대화 흐름은 유지한다(베스트 표시만 붙는다).
 * 대댓글: 한 단계. 답글의 답글은 같은 부모에 붙는다(DB 트리거가 강제).
 *
 * 로그인 라이브러리는 세션이 있을 때만 뒤늦게 불러온다 — 읽기만 하는 방문자에게
 * 170KB 를 내려주지 않기 위해서다.
 */
(function () {
  const URL = "__SUPABASE_URL__";
  const KEY = "__SUPABASE_PUBLISHABLE_KEY__";
  const BEST_MIN = 10;   // 이만큼 추천을 받아야 베스트 후보. 회원이 늘면 올린다.
  const BEST_MAX = 3;    // 상단 고정 개수
  const root = document.getElementById("comments");
  if (!root) return;
  const TT = root.dataset.targetType, TID = root.dataset.targetId;
  const COPY = {
    posting: { ph: "이 공고에 대해 묻거나 아는 것을 나눠 주세요. 사실이 아닌 내용, 담당자 연락처, 광고는 쓸 수 없습니다.",
               empty: "아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.",
               fine: "댓글은 <a href=\"/terms\">이용약관</a> 제6조를 따릅니다." },
    firm:    { ph: "이 법인에 대해 아는 것을 나눠 주세요. 직접 겪거나 확인한 사실을 적고, 확인되지 않은 내용을 사실처럼 쓰면 명예훼손이 될 수 있습니다. 개인 이름·연락처는 쓸 수 없습니다.",
               empty: "아직 댓글이 없습니다. 이 법인에 대해 아는 것이 있으면 나눠 주세요.",
               fine: "법인에 대한 댓글은 <a href=\"/terms\">이용약관</a> 제6조를 따르며, 확인되지 않은 내용을 사실처럼 쓰면 명예훼손이 될 수 있습니다. 법인 측은 <a href=\"mailto:contact@cpaping.com\">contact@cpaping.com</a> 으로 정정·삭제를 요청할 수 있습니다." },
    post:    { ph: "댓글을 남겨 주세요.", empty: "아직 댓글이 없습니다.", fine: "댓글은 <a href=\"/terms\">이용약관</a> 제6조를 따릅니다." },
  }[TT] || { ph: "댓글을 남겨 주세요.", empty: "아직 댓글이 없습니다.", fine: "" };

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ago = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "방금"; if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`; if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
    return iso.slice(0, 10).replace(/-/g, ".");
  };
  const REASONS = [["defamation", "허위사실·명예훼손"], ["privacy", "개인정보·연락처"], ["ad", "광고·홍보"], ["abuse", "욕설·비하"], ["other", "기타"]];
  const HUMAN = [
    [/rate_limited/, "너무 빠릅니다. 댓글은 10분에 5개, 추천은 10분에 30번까지입니다. 잠시 뒤에 다시 시도해 주세요."],
    [/profile_incomplete/, "닉네임을 정하면 댓글과 추천을 쓸 수 있습니다."],
    [/email_required/, "이메일 인증을 마치면 댓글과 추천을 쓸 수 있습니다."],
    [/comments_no_contact/, "전화번호나 이메일 주소는 댓글에 쓸 수 없습니다. 지원·문의는 공고 원문의 연락처로 해주세요."],
    [/comments_body_len/, "댓글은 1~1,000자여야 합니다."],
    [/votes_own/, "내 댓글은 추천할 수 없습니다."],
    [/votes_unavailable/, "지금은 추천할 수 없는 댓글입니다."],
    [/reply_parent_gone/, "삭제된 댓글에는 답글을 달 수 없습니다."],
    [/reply_depth|reply_target_mismatch/, "이 댓글에는 답글을 달 수 없습니다."],
    [/reports_once/, "이미 신고한 댓글입니다."],
    [/comment_votes_pkey/, "이미 추천한 댓글입니다."],
    [/duplicate key/, "이미 처리된 요청입니다."],
    [/JWT|jwt|401|403|42501/, "로그인이 풀렸습니다. 다시 로그인해 주세요."],
  ];
  const humanize = (e) => { const m = String(e?.message || e || ""); for (const [re, t] of HUMAN) if (re.test(m)) return t; return "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요." + (m ? ` (${m})` : ""); };
  const hasContact = (t) => /01[016789][-. ]?\d{3,4}[-. ]?\d{4}/.test(t) || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(t);

  let auth = null;      // window.cpAuth (세션이 있을 때만)
  let me = { state: "anon" };
  let list = [];        // 뷰가 준 그대로(시간순). 답글도 섞여 있다.

  function hasSessionKey() {
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true; } } catch {}
    return false;
  }
  function loadScript(src) {
    return new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("load " + src)); document.head.append(s); });
  }
  async function loadAuth() {
    if (window.cpAuth) return window.cpAuth;
    await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js");
    await loadScript("/auth.js");
    return window.cpAuth;
  }

  async function fetchList() {
    const headers = { apikey: KEY, Authorization: "Bearer " + KEY };
    if (me.session) headers.Authorization = "Bearer " + me.session.access_token;   // mine·voted 계산용
    const res = await fetch(`${URL}/rest/v1/comments_public?target_type=eq.${encodeURIComponent(TT)}&target_id=eq.${encodeURIComponent(TID)}&order=created_at.asc`, { headers });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  /** 원댓글·답글·베스트를 가른다. 부모가 목록에 없는 답글은 원댓글처럼 보여준다. */
  function shape() {
    const ids = new Set(list.map((c) => c.id));
    const tops = list.filter((c) => !c.parent_id || !ids.has(c.parent_id));
    const replies = new Map();
    for (const c of list) if (c.parent_id && ids.has(c.parent_id)) (replies.get(c.parent_id) || replies.set(c.parent_id, []).get(c.parent_id)).push(c);
    const best = tops.filter((c) => c.status === "visible" && (c.votes || 0) >= BEST_MIN)
      .sort((a, b) => (b.votes || 0) - (a.votes || 0) || a.created_at.localeCompare(b.created_at))
      .slice(0, BEST_MAX);
    return { tops, replies, best, bestIds: new Set(best.map((c) => c.id)) };
  }

  function item(c, S, opt = {}) {
    const canWrite = me.state === "complete";
    const visible = c.status === "visible";
    const kids = S.replies.get(c.id) || [];
    const cls = ["cm", opt.reply ? "cm-reply" : "", opt.pinned ? "cm-pinned" : "", c.status === "hidden" ? "hidden-cm" : "", c.status === "removed" ? "removed-cm" : ""].filter(Boolean).join(" ");
    const name = c.status === "removed" ? "삭제된 댓글" : c.nickname;
    const body = c.status === "hidden" ? `<p class="cm-body muted">신고되어 검토 중인 댓글입니다.</p>`
      : c.status === "removed" ? `<p class="cm-body muted">삭제된 댓글입니다.</p>`
      : `<p class="cm-body">${esc(c.body)}</p>`;
    // 고정된 복사본에는 수정·삭제·신고·답글을 두지 않는다 — 원래 자리에 있다.
    const acts = opt.pinned ? "" :
      c.mine && visible ? `<span class="cm-act"><button type="button" class="linkish" data-edit="${c.id}">수정</button><button type="button" class="linkish" data-del="${c.id}" data-kids="${kids.length}">삭제</button></span>` :
      !c.mine && canWrite && visible ? `<span class="cm-act"><button type="button" class="linkish" data-report="${c.id}">신고</button></span>` : "";
    const foot = visible ? `<div class="cm-foot">
        <button type="button" class="cm-vote${c.voted ? " on" : ""}" data-vote="${c.id}" aria-pressed="${c.voted ? "true" : "false"}" title="${c.voted ? "추천 취소" : "추천"}">▲ 추천 <span>${c.votes || 0}</span></button>
        ${!opt.reply && !opt.pinned ? `<button type="button" class="linkish" data-reply="${c.id}">답글${kids.length ? ` ${kids.length}` : ""}</button>` : ""}
      </div>` : "";
    return `
      <li class="${cls}" data-id="${c.id}">
        <div class="cm-head"><b class="${c.author_left ? "left" : ""}">${esc(name)}</b>
          ${S.bestIds.has(c.id) ? `<span class="badge-best">베스트</span>` : ""}
          <span class="cm-time">${ago(c.created_at)}${c.edited_at && visible ? " · 수정됨" : ""}</span>
          ${acts}
        </div>
        ${body}
        ${foot}
        ${opt.pinned ? "" : `<div class="cm-inline" id="inline-${c.id}" hidden></div>`}
        ${!opt.reply && !opt.pinned && kids.length ? `<ul class="cm-replies">${kids.map((r) => item(r, S, { reply: true })).join("")}</ul>` : ""}
      </li>`;
  }

  function render() {
    const S = shape();
    const count = list.filter((c) => c.status !== "removed").length;
    const gate =
      me.state === "complete" ? `
        <form id="cm-form" class="cm-form" novalidate>
          <textarea id="cm-body" maxlength="1000" rows="3" placeholder="${esc(COPY.ph)}"></textarea>
          <div class="cm-form-row"><span class="cm-count" id="cm-count">0 / 1000</span><button class="btn primary" type="submit">댓글 남기기</button></div>
        </form>` :
      me.state === "anon" ? `<p class="cm-gate"><a href="/login/?returnTo=${encodeURIComponent(location.pathname + "#comments")}">로그인</a>하면 댓글을 쓰고 추천할 수 있습니다. 읽는 데는 필요 없습니다.</p>` :
      `<p class="cm-gate"><a href="/onboarding/">가입을 마무리</a>하면 댓글을 쓰고 추천할 수 있습니다.</p>`;

    root.innerHTML = `
      <div class="sec-head"><h2>댓글</h2><span class="unit">${count}개</span></div>
      ${S.best.length ? `<div class="cm-best"><div class="cm-best-head">베스트 댓글 <span class="muted">추천 ${BEST_MIN}개 이상, 많은 순</span></div>
        <ul class="cm-list">${S.best.map((c) => item(c, S, { pinned: true })).join("")}</ul></div>` : ""}
      ${S.tops.length ? `<ul class="cm-list">${S.tops.map((c) => item(c, S)).join("")}</ul>` : `<p class="muted small" style="margin:0 0 12px">${esc(COPY.empty)}</p>`}
      ${gate}
      <div class="msg" id="cm-msg" hidden role="status" aria-live="polite"></div>
      <p class="cm-fine">${COPY.fine} 권리 침해 신고는 댓글의 <b>신고</b> 또는 <a href="mailto:contact@cpaping.com">contact@cpaping.com</a>.</p>`;
    wire();
  }

  const msg = (t, kind) => { const m = document.getElementById("cm-msg"); if (!m) return; m.textContent = t; m.className = "msg" + (kind ? " " + kind : ""); m.hidden = false; };
  const find = (id) => list.find((x) => String(x.id) === String(id));

  /** 회원이 아니면 로그인·가입 마무리로 보낸다. 회원이면 true. */
  function requireMember() {
    if (me.state === "complete") return true;
    if (me.state === "anon") { location.href = `/login/?returnTo=${encodeURIComponent(location.pathname + "#comments")}`; return false; }
    location.href = "/onboarding/";
    return false;
  }

  async function post(body, parentId) {
    if (!body) { msg("내용을 입력해 주세요.", "err"); return false; }
    if (hasContact(body)) { msg("전화번호나 이메일 주소는 댓글에 쓸 수 없습니다.", "err"); return false; }
    const row = { target_type: TT, target_id: TID, author_id: me.user.id, body };
    if (parentId) row.parent_id = Number(parentId);
    const { error } = await auth.client.from("comments").insert(row);
    if (error) { msg(humanize(error), "err"); return false; }
    await refresh();
    msg(parentId ? "답글을 남겼습니다." : "댓글을 남겼습니다.", "ok");
    return true;
  }

  function wire() {
    const form = document.getElementById("cm-form");
    if (form) {
      const ta = document.getElementById("cm-body"), cnt = document.getElementById("cm-count");
      ta.addEventListener("input", () => { cnt.textContent = `${ta.value.length} / 1000`; });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = form.querySelector("button"); btn.disabled = true;
        const ok = await post(ta.value.trim(), null);
        if (!ok) btn.disabled = false;
      });
    }

    // 추천 — 낙관적으로 먼저 바꾸고, 서버가 거절하면 되돌린다
    root.querySelectorAll("[data-vote]").forEach((b) => b.onclick = async () => {
      if (!requireMember()) return;
      const c = find(b.dataset.vote);
      if (!c) return;
      if (c.mine) return msg("내 댓글은 추천할 수 없습니다.", "err");
      const was = { votes: c.votes || 0, voted: !!c.voted };
      c.voted = !was.voted; c.votes = Math.max(0, was.votes + (c.voted ? 1 : -1));
      render();
      const q = auth.client.from("comment_votes");
      const { error } = was.voted
        ? await q.delete().eq("comment_id", c.id).eq("voter_id", me.user.id)
        : await q.insert({ comment_id: c.id, voter_id: me.user.id });
      if (error) { c.votes = was.votes; c.voted = was.voted; render(); return msg(humanize(error), "err"); }
      await refresh();
    });

    // 답글
    root.querySelectorAll("[data-reply]").forEach((b) => b.onclick = () => {
      if (!requireMember()) return;
      const id = b.dataset.reply, box = document.getElementById("inline-" + id);
      box.hidden = false;
      box.innerHTML = `<textarea maxlength="1000" rows="2" placeholder="답글을 남겨 주세요. 연락처는 쓸 수 없습니다."></textarea>
        <div class="cm-form-row"><button type="button" class="linkish" data-cancel>취소</button><button type="button" class="btn" data-send>답글 남기기</button></div>`;
      box.querySelector("textarea").focus();
      box.querySelector("[data-cancel]").onclick = () => { box.hidden = true; box.innerHTML = ""; };
      box.querySelector("[data-send]").onclick = async () => {
        box.querySelector("[data-send]").disabled = true;
        const ok = await post(box.querySelector("textarea").value.trim(), id);
        if (!ok) box.querySelector("[data-send]").disabled = false;
      };
    });

    root.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      const kids = Number(b.dataset.kids || 0);
      if (!confirm(kids ? "답글이 달린 댓글입니다. 본문은 지워지고 \"삭제된 댓글\" 자리만 남습니다. 삭제할까요?" : "이 댓글을 삭제할까요?")) return;
      const { error } = await auth.client.from("comments").delete().eq("id", Number(b.dataset.del));
      if (error) return msg(humanize(error), "err");
      await refresh();
    });
    root.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
      const id = b.dataset.edit, c = find(id), box = document.getElementById("inline-" + id);
      box.hidden = false;
      box.innerHTML = `<textarea maxlength="1000" rows="3">${esc(c.body)}</textarea><div class="cm-form-row"><button type="button" class="linkish" data-cancel>취소</button><button type="button" class="btn" data-save>저장</button></div>`;
      box.querySelector("[data-cancel]").onclick = () => { box.hidden = true; box.innerHTML = ""; };
      box.querySelector("[data-save]").onclick = async () => {
        const body = box.querySelector("textarea").value.trim();
        if (!body) return msg("내용을 입력해 주세요.", "err");
        if (hasContact(body)) return msg("전화번호나 이메일 주소는 댓글에 쓸 수 없습니다.", "err");
        const { error } = await auth.client.from("comments").update({ body }).eq("id", Number(id));
        if (error) return msg(humanize(error), "err");
        await refresh();
      };
    });
    root.querySelectorAll("[data-report]").forEach((b) => b.onclick = () => {
      const id = b.dataset.report, box = document.getElementById("inline-" + id);
      box.hidden = false;
      box.innerHTML = `<div class="cm-report"><b>이 댓글을 신고합니다</b>
        ${REASONS.map(([v, l], i) => `<label><input type="radio" name="reason-${id}" value="${v}"${i === 0 ? " checked" : ""}> ${l}</label>`).join("")}
        <input type="text" maxlength="500" placeholder="구체적인 내용 (선택)" data-detail>
        <div class="cm-form-row"><button type="button" class="linkish" data-cancel>취소</button><button type="button" class="btn" data-send>신고하기</button></div>
        <p class="cm-fine" style="margin-top:6px">신고가 접수되면 댓글은 즉시 비공개로 바뀌고, 운영자가 30일 안에 확인해 결과를 알립니다.</p></div>`;
      box.querySelector("[data-cancel]").onclick = () => { box.hidden = true; box.innerHTML = ""; };
      box.querySelector("[data-send]").onclick = async () => {
        const reason = box.querySelector(`input[name="reason-${id}"]:checked`).value;
        const detail = box.querySelector("[data-detail]").value.trim() || null;
        const { error } = await auth.client.from("reports").insert({ comment_id: Number(id), reporter_id: me.user.id, reason, detail });
        if (error) return msg(humanize(error), "err");
        await refresh(); msg("신고를 접수했습니다. 댓글은 검토가 끝날 때까지 비공개로 바뀝니다.", "ok");
      };
    });
  }

  async function refresh() {
    try { list = await fetchList(); } catch (e) { root.innerHTML = `<div class="sec-head"><h2>댓글</h2></div><p class="muted small">댓글을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</p>`; return; }
    render();
  }

  (async () => {
    // 1) 먼저 읽기만으로 그린다 (누구에게나 빠르게)
    await refresh();
    // 2) 세션이 있으면 로그인 라이브러리를 불러와 쓰기 권한을 판단한다
    if (!hasSessionKey()) return;
    try {
      auth = await loadAuth();
      me = await auth.getState();
      await refresh();   // mine·voted 를 다시 계산해 내 댓글의 버튼과 추천 상태를 켠다
    } catch (e) { console.warn("댓글 로그인 상태 확인 실패:", e.message); }
  })();
})();
