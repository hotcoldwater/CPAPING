/**
 * 댓글 (Phase 5). 공고 상세 페이지에 붙는다. 법인·게시판도 같은 코드를 쓴다 —
 * <section id="comments" data-target-type="posting" data-target-id="…"> 만 다르다.
 *
 * 읽기는 누구나(공개 뷰를 fetch 로), 쓰기는 가입을 마친 회원만.
 * 로그인 라이브러리는 세션이 있을 때만 뒤늦게 불러온다 — 읽기만 하는 방문자에게
 * 170KB 를 내려주지 않기 위해서다.
 */
(function () {
  const URL = "__SUPABASE_URL__";
  const KEY = "__SUPABASE_PUBLISHABLE_KEY__";
  const root = document.getElementById("comments");
  if (!root) return;
  const TT = root.dataset.targetType, TID = root.dataset.targetId;

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ago = (iso) => {
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 60) return "방금"; if (s < 3600) return `${Math.floor(s / 60)}분 전`;
    if (s < 86400) return `${Math.floor(s / 3600)}시간 전`; if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
    return iso.slice(0, 10).replace(/-/g, ".");
  };
  const REASONS = [["defamation", "허위사실·명예훼손"], ["privacy", "개인정보·연락처"], ["ad", "광고·홍보"], ["abuse", "욕설·비하"], ["other", "기타"]];
  const HUMAN = [
    [/rate_limited/, "댓글은 10분에 5개까지 쓸 수 있습니다. 잠시 뒤에 다시 시도해 주세요."],
    [/profile_incomplete/, "닉네임을 정하면 댓글을 쓸 수 있습니다."],
    [/email_required/, "이메일 인증을 마치면 댓글을 쓸 수 있습니다."],
    [/comments_no_contact/, "전화번호나 이메일 주소는 댓글에 쓸 수 없습니다. 지원·문의는 공고 원문의 연락처로 해주세요."],
    [/comments_body_len/, "댓글은 1~1,000자여야 합니다."],
    [/reports_once|duplicate key/, "이미 신고한 댓글입니다."],
    [/JWT|jwt|401|403|42501/, "로그인이 풀렸습니다. 다시 로그인해 주세요."],
  ];
  const humanize = (e) => { const m = String(e?.message || e || ""); for (const [re, t] of HUMAN) if (re.test(m)) return t; return "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요." + (m ? ` (${m})` : ""); };

  let auth = null;      // window.cpAuth (세션이 있을 때만)
  let me = { state: "anon" };
  let list = [];

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
    if (me.session) headers.Authorization = "Bearer " + me.session.access_token;   // mine 계산용
    const res = await fetch(`${URL}/rest/v1/comments_public?target_type=eq.${encodeURIComponent(TT)}&target_id=eq.${encodeURIComponent(TID)}&order=created_at.asc`, { headers });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function render() {
    const canWrite = me.state === "complete";
    const items = list.map((c) => `
      <li class="cm${c.status === "hidden" ? " hidden-cm" : ""}" data-id="${c.id}">
        <div class="cm-head"><b class="${c.author_left ? "left" : ""}">${esc(c.nickname)}</b>
          <span class="cm-time">${ago(c.created_at)}${c.edited_at ? " · 수정됨" : ""}</span>
          ${c.mine && c.status === "visible" ? `<span class="cm-act"><button type="button" class="linkish" data-edit="${c.id}">수정</button><button type="button" class="linkish" data-del="${c.id}">삭제</button></span>` : ""}
          ${!c.mine && canWrite && c.status === "visible" ? `<span class="cm-act"><button type="button" class="linkish" data-report="${c.id}">신고</button></span>` : ""}
        </div>
        ${c.status === "hidden" ? `<p class="cm-body muted">신고되어 검토 중인 댓글입니다.</p>` : `<p class="cm-body">${esc(c.body)}</p>`}
        <div class="cm-inline" id="inline-${c.id}" hidden></div>
      </li>`).join("");

    const gate =
      me.state === "complete" ? `
        <form id="cm-form" class="cm-form" novalidate>
          <textarea id="cm-body" maxlength="1000" rows="3" placeholder="이 공고에 대해 묻거나 아는 것을 나눠 주세요. 사실이 아닌 내용, 담당자 연락처, 광고는 쓸 수 없습니다."></textarea>
          <div class="cm-form-row"><span class="cm-count" id="cm-count">0 / 1000</span><button class="btn primary" type="submit">댓글 남기기</button></div>
        </form>` :
      me.state === "anon" ? `<p class="cm-gate"><a href="/login/?returnTo=${encodeURIComponent(location.pathname + "#comments")}">로그인</a>하면 댓글을 쓸 수 있습니다. 읽는 데는 필요 없습니다.</p>` :
      `<p class="cm-gate"><a href="/onboarding/">가입을 마무리</a>하면 댓글을 쓸 수 있습니다.</p>`;

    root.innerHTML = `
      <div class="sec-head"><h2>댓글</h2><span class="unit">${list.length}개</span></div>
      ${list.length ? `<ul class="cm-list">${items}</ul>` : `<p class="muted small" style="margin:0 0 12px">아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.</p>`}
      ${gate}
      <div class="msg" id="cm-msg" hidden role="status" aria-live="polite"></div>
      <p class="cm-fine">댓글은 <a href="/terms">이용약관</a> 제6조를 따릅니다. 권리 침해 신고는 댓글의 <b>신고</b> 또는 <a href="mailto:contact@cpaping.com">contact@cpaping.com</a>.</p>`;
    wire();
  }

  const msg = (t, kind) => { const m = document.getElementById("cm-msg"); if (!m) return; m.textContent = t; m.className = "msg" + (kind ? " " + kind : ""); m.hidden = false; };

  function wire() {
    const form = document.getElementById("cm-form");
    if (form) {
      const ta = document.getElementById("cm-body"), cnt = document.getElementById("cm-count");
      ta.addEventListener("input", () => { cnt.textContent = `${ta.value.length} / 1000`; });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = ta.value.trim();
        if (!body) return msg("내용을 입력해 주세요.", "err");
        if (/01[016789][-. ]?\d{3,4}[-. ]?\d{4}/.test(body) || /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(body))
          return msg("전화번호나 이메일 주소는 댓글에 쓸 수 없습니다.", "err");
        form.querySelector("button").disabled = true;
        const { error } = await auth.client.from("comments").insert({ target_type: TT, target_id: TID, author_id: me.user.id, body });
        if (error) { msg(humanize(error), "err"); form.querySelector("button").disabled = false; return; }
        await refresh(); msg("댓글을 남겼습니다.", "ok");
      });
    }
    root.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (!confirm("이 댓글을 삭제할까요?")) return;
      const { error } = await auth.client.from("comments").delete().eq("id", Number(b.dataset.del));
      if (error) return msg(humanize(error), "err");
      await refresh();
    });
    root.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
      const id = b.dataset.edit, c = list.find((x) => String(x.id) === id), box = document.getElementById("inline-" + id);
      box.hidden = false;
      box.innerHTML = `<textarea maxlength="1000" rows="3">${esc(c.body)}</textarea><div class="cm-form-row"><button type="button" class="linkish" data-cancel>취소</button><button type="button" class="btn" data-save>저장</button></div>`;
      box.querySelector("[data-cancel]").onclick = () => { box.hidden = true; box.innerHTML = ""; };
      box.querySelector("[data-save]").onclick = async () => {
        const body = box.querySelector("textarea").value.trim();
        if (!body) return msg("내용을 입력해 주세요.", "err");
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
      await refresh();   // mine 을 다시 계산해 내 댓글의 수정·삭제 버튼을 켠다
    } catch (e) { console.warn("댓글 로그인 상태 확인 실패:", e.message); }
  })();
})();
