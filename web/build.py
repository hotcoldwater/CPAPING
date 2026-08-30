"""web/index.html 의 플레이스홀더에 Supabase 공개 키를 채워 dist/ 로 낸다.

publishable key 는 프론트엔드에 노출되도록 설계된 값이라 브라우저에 담아도
안전하다. 다만 소스에 하드코딩해 두면 프로젝트를 바꿀 때 놓치기 쉬워
빌드 시점에 주입한다.

    python web/build.py
"""

import os
import pathlib
import sys

from dotenv import load_dotenv

ROOT = pathlib.Path(__file__).resolve().parent
load_dotenv(ROOT.parent / ".env")

REPLACEMENTS = {
    "__SUPABASE_URL__": "NEXT_PUBLIC_SUPABASE_URL",
    "__SUPABASE_PUBLISHABLE_KEY__": "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
}


def main() -> int:
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    missing = []
    for placeholder, env_name in REPLACEMENTS.items():
        value = os.environ.get(env_name, "")
        if not value or value.startswith("http://xxx") or "xxxx" in value:
            missing.append(env_name)
            continue
        html = html.replace(placeholder, value)

    if missing:
        print(f"환경변수가 없습니다: {', '.join(missing)}", file=sys.stderr)
        return 1

    out = ROOT / "dist"
    out.mkdir(exist_ok=True)
    (out / "index.html").write_text(html, encoding="utf-8")
    print(f"빌드 완료 → {out / 'index.html'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
