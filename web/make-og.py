"""OG 이미지(카카오톡·트위터 공유 카드)를 그린다.

    python web/make-og.py

실제 공고 목록 일부를 그대로 보여주는 '미리보기형'이다. 서비스 설명
문장보다 실제 화면이 무엇을 하는 곳인지 더 빨리 알려준다고 보고 택했다.

공고 내용은 예시로 고정한다. 실제 데이터를 매번 반영하면 이미지가 바뀌는데,
카카오는 OG 이미지를 캐시하므로 자주 바꿔봐야 반영되지 않는다.
"""

import pathlib

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).resolve().parent
FONT_PATH = "/System/Library/Fonts/AppleSDGothicNeo.ttc"

W, H = 1200, 630

INK, INK_2, INK_3 = "#101317", "#5B6472", "#868D99"
LINE, BG, BG_SUBTLE = "#E4E6EA", "#FFFFFF", "#FBFBFC"
ACCENT, URGENT, LIVE = "#123A8A", "#B4341F", "#17A05F"
CHIP_BG, CHIP_FG = "#EEF1F6", "#4A5462"

# (법인명, 제목, 지역, D-day, 날짜, 임박 여부)
ROWS = [
    ("새빛회계법인", "2026년 신입 공인회계사 모집", "서울 용산구", "D-6", "09.06", True),
    ("성현회계법인", "2026 신입 공인회계사 공채", "지역무관", "D-4", "09.04", True),
    ("동성회계법인", "수습 회계사 채용", "지역무관", "D-30", "09.30", False),
]


def font(size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    """AppleSDGothicNeo.ttc 안의 굵기별 서브폰트. 0=Regular, 2=Bold 근처."""
    return ImageFont.truetype(FONT_PATH, size, index=index)


def main() -> None:
    img = Image.new("RGB", (W, H), BG_SUBTLE)
    d = ImageDraw.Draw(img)

    # 카드 (실제 사이트의 720px 셸을 흉내 낸다)
    x0, y0, x1, y1 = 100, 60, W - 100, H - 60
    d.rectangle([x0, y0, x1, y1], fill=BG, outline=LINE, width=1)
    pad = 44

    # 상단 바
    bar_h = 58
    d.rectangle([x0, y0, x1, y0 + bar_h], fill=BG_SUBTLE, outline=LINE, width=1)
    d.text((x0 + pad, y0 + 18), "CPAPING", font=font(22, 2), fill=INK)
    dot_y = y0 + bar_h // 2
    d.ellipse([x1 - pad - 150, dot_y - 5, x1 - pad - 140, dot_y + 5], fill=LIVE)
    d.text((x1 - pad - 128, y0 + 19), "10분마다 확인 중", font=font(16), fill=INK_2)

    # 헤드라인 — 한 줄에 담아 목록 공간을 남긴다
    y = y0 + bar_h + 38
    d.text((x0 + pad, y), "회계법인 수습 공고를 놓치지 마세요", font=font(40, 2), fill=INK)
    d.text((x0 + pad, y + 62),
           "한국공인회계사회에 새 공고가 올라오면 메일로 알려드립니다.",
           font=font(20), fill=INK_2)

    # 공고 목록
    y = y + 116
    d.line([x0 + pad, y, x1 - pad, y], fill=LINE, width=1)

    row_h = 82
    for firm, title, region, dday, date, soon in ROWS:
        top = y + 18
        # 법인명과 지역을 한 줄에 붙여 높이를 아낀다
        d.text((x0 + pad, top), f"{firm} · {region}", font=font(16), fill=INK_2)
        d.text((x0 + pad, top + 24), title, font=font(23, 2), fill=INK)

        color = URGENT if soon else INK
        dw = d.textlength(dday, font=font(19, 2))
        d.text((x1 - pad - dw, top + 14), dday, font=font(19, 2), fill=color)
        vw = d.textlength(date, font=font(15))
        d.text((x1 - pad - vw, top + 40), date, font=font(15), fill=INK_3)

        y += row_h
        d.line([x0 + pad, y, x1 - pad, y], fill="#EDEFF2", width=1)

    d.text((x0 + pad, y + 20), "cpaping.com", font=font(18, 2), fill=ACCENT)

    out = HERE / "og.png"
    img.save(out, optimize=True)
    print(f"OG 이미지 생성 → {out} ({out.stat().st_size // 1024}KB)")


if __name__ == "__main__":
    main()
