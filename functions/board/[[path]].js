/**
 * /board/<번호>/ 를 글 화면(정적 셸 /board/post/)으로 잇는다. 그 밖의 /board/… 는 정적 파일 그대로.
 *
 * 글 내용은 화면이 Supabase 에서 읽는다 — 글은 수시로 생기고 바뀌어 빌드 시점에 박아 둘 수 없다.
 * 검색엔진용 서버 렌더링은 게시판이 자리잡은 뒤에 한다.
 */
export async function onRequest({ request, env, params }) {
  const parts = (params.path || []).filter(Boolean);
  if (parts.length === 1 && /^\d{1,12}$/.test(parts[0])) {
    const shell = await env.ASSETS.fetch(new URL("/board/post/", request.url));
    return new Response(shell.body, {
      status: shell.ok ? 200 : shell.status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return env.ASSETS.fetch(request);
}
