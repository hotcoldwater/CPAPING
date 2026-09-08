/**
 * 회원 인증 (Phase 3). 모든 회원 페이지가 이 파일을 쓴다.
 *
 * 계정은 Supabase Auth 가 갖고, 우리는 profiles(닉네임)만 붙인다.
 * 회원 식별은 언제나 auth user id 다 — 카카오는 이메일 없이 들어온다.
 *
 * 온보딩 상태는 저장하지 않고 세 가지 사실로 계산한다.
 *   anon           세션 없음
 *   needs_email    이메일이 없거나 확인되지 않음 (카카오, 이메일 가입 직후)
 *   needs_profile  이메일은 됐는데 닉네임이 없음
 *   complete       둘 다 있음
 * 상태를 캐시하면 트리거로 맞춰야 하고, 어긋나면 사용자가 온보딩에 갇힌다.
 *
 * 비밀값은 없다. 아래 두 값은 공개 키이고 빌드가 채운다.
 */
(function () {
  const URL = "__SUPABASE_URL__";
  const KEY = "__SUPABASE_PUBLISHABLE_KEY__";

  const client = window.supabase.createClient(URL, KEY, {
    auth: {
      flowType: "pkce",          // OAuth 콜백은 ?code= 로 온다. 토큰이 주소에 실리지 않는다
      persistSession: true,      // localStorage — 재방문 때 다시 로그인시키지 않는다
      autoRefreshToken: true,
      detectSessionInUrl: true,  // /auth/callback/ 에서 code 를 세션으로 바꾼다
    },
  });

  /** 로그인 뒤 돌아갈 곳. 같은 출처의 경로만 받는다 — 밖으로 튕기는 링크를 막는다. */
  function safeReturnTo(value) {
    if (typeof value !== "string") return "/";
    if (!/^\/(?!\/)/.test(value)) return "/";              // '/' 로 시작, '//' 금지
    if (/^\/(login|auth|onboarding)(\/|$)/.test(value)) return "/";  // 인증 화면으로 되돌아가는 고리 금지
    return value;
  }
  const RETURN_KEY = "cpaping.returnTo";
  function rememberReturnTo(value) {
    try { sessionStorage.setItem(RETURN_KEY, safeReturnTo(value)); } catch {}
  }
  function takeReturnTo() {
    try {
      const v = sessionStorage.getItem(RETURN_KEY);
      sessionStorage.removeItem(RETURN_KEY);
      return safeReturnTo(v);
    } catch { return "/"; }
  }

  async function getState() {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return { state: "anon" };
    // getUser 는 서버에 물어 확정된 값을 준다. 세션 캐시만 믿으면 방금 확인한 이메일이 안 보인다.
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return { state: "anon" };

    const emailOk = Boolean(user.email) && Boolean(user.email_confirmed_at);
    if (!emailOk) return { state: "needs_email", user, session };

    const { data: profile } = await client
      .from("profiles").select("nickname").eq("user_id", user.id).maybeSingle();
    if (!profile || !profile.nickname) return { state: "needs_profile", user, session, profile };
    return { state: "complete", user, session, profile };
  }

  /** 상태에 맞는 화면으로 보낸다. 이미 그 화면이면 아무것도 하지 않는다(무한 이동 방지). */
  function routeFor(state) {
    return { anon: "/login/", needs_email: "/onboarding/", needs_profile: "/onboarding/" }[state] || null;
  }
  async function ensure(required) {
    const s = await getState();
    const order = ["anon", "needs_email", "needs_profile", "complete"];
    if (order.indexOf(s.state) >= order.indexOf(required)) return s;
    const to = routeFor(s.state);
    if (to && !location.pathname.startsWith(to)) {
      if (s.state === "anon") rememberReturnTo(location.pathname + location.search);
      location.replace(to);
    }
    return s;
  }

  async function signInWith(provider) {
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}/auth/callback/` },
    });
    if (error) throw error;
  }

  async function signOut() {
    await client.auth.signOut();
    try { sessionStorage.removeItem(RETURN_KEY); } catch {}
  }

  /** abc***@naver.com */
  function maskEmail(email) {
    if (!email || !email.includes("@")) return "";
    const [local, domain] = email.split("@");
    return (local.length > 3 ? local.slice(0, 3) : local.slice(0, 1)) + "***@" + domain;
  }

  /** Supabase 오류를 사람이 읽을 한국어로. 모르는 건 원문을 붙여 준다. */
  function humanize(error) {
    const m = String(error?.message || error || "");
    const table = [
      [/invalid login credentials/i, "이메일 또는 비밀번호가 맞지 않습니다."],
      [/email not confirmed/i, "이메일 확인이 아직 끝나지 않았습니다. 받은편지함(스팸함 포함)의 링크를 눌러주세요."],
      [/user already registered/i, "이미 가입된 이메일입니다. 로그인해 주세요."],
      [/password should be at least/i, "비밀번호는 8자 이상이어야 합니다."],
      [/rate limit|too many requests/i, "요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요."],
      [/invalid email|unable to validate email/i, "이메일 주소 형식을 확인해 주세요."],
      [/same password/i, "이전과 다른 비밀번호를 정해 주세요."],
      [/email address .* is invalid/i, "이메일 주소 형식을 확인해 주세요."],
      [/duplicate key|23505/, "이미 쓰고 있는 닉네임입니다."],
      [/profiles_nickname_len/, "닉네임은 2~12자여야 합니다."],
      [/profiles_nickname_reserved/, "운영자·공식·관리자 같은 문구는 닉네임에 쓸 수 없습니다."],
    ];
    for (const [re, text] of table) if (re.test(m)) return text;
    return "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요." + (m ? ` (${m})` : "");
  }

  window.cpAuth = { client, getState, ensure, signInWith, signOut, safeReturnTo,
                    rememberReturnTo, takeReturnTo, maskEmail, humanize };
})();
