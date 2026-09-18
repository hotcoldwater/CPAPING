"""Render the sharing artwork: python web/make-og.py.

Essential copy stays inside the central square for cropped thumbnails.
Set CPAPING_OG_FONT to a Korean-capable .ttf on another platform.
Commit the PNGs; the web build only copies them.
"""
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
W, H, SCALE = 1200, 630, 2
NAVY, WHITE, MINT = "#102B4E", "#FAFCFF", "#A2F1CC"
FONT_PATH = os.environ.get("CPAPING_OG_FONT", "/System/Library/Fonts/AppleSDGothicNeo.ttc")


def font(size, bold=False):
    index = 6 if bold and FONT_PATH.endswith("AppleSDGothicNeo.ttc") else 0
    return ImageFont.truetype(FONT_PATH, size * SCALE, index=index)


def main():
    img = Image.new("RGB", (W * SCALE, H * SCALE), NAVY)
    draw = ImageDraw.Draw(img)

    def box(points):
        return tuple(round(v * SCALE) for v in points)

    def centered(text, y, size, color=WHITE, bold=False):
        face = font(size, bold)
        bounds = draw.textbbox((0, 0), text, font=face)
        width = bounds[2] - bounds[0]
        assert width <= 590 * SCALE, f"Copy exceeds square crop safe area: {text}"
        draw.text(((W * SCALE - width) / 2 - bounds[0], y * SCALE - bounds[1]),
                  text, font=face, fill=color)

    # Side illustrations suggest collected notices and mail. They may be cropped.
    for x, y in [(-58, 224), (-34, 204), (-10, 184)]:
        draw.rounded_rectangle(box((x, y, x + 214, y + 242)), radius=18 * SCALE,
                               fill=NAVY, outline="#284868", width=2 * SCALE)
    for y, length in [(235, 98), (260, 130), (301, 110), (326, 76)]:
        draw.rounded_rectangle(box((30, y, 30 + length, y + 7)),
                               radius=3 * SCALE, fill="#365674")
    draw.rounded_rectangle(box((1000, 237, 1236, 401)), radius=18 * SCALE,
                           fill="#183857", outline="#365674", width=2 * SCALE)
    draw.line([box((1007, 247)), box((1118, 323)), box((1228, 247))],
              fill="#52728B", width=3 * SCALE)
    draw.ellipse(box((1164, 211, 1192, 239)), fill=MINT)

    centered("CPAPING", 78, 42, bold=True)
    draw.rounded_rectangle(box((564, 149, 636, 153)), radius=2 * SCALE, fill=MINT)
    centered("신입 회계사 공고,", 204, 66, bold=True)
    centered("한곳에.", 291, 100, MINT, bold=True)
    centered("새 공고는 메일로 받아보세요", 438, 37)
    centered("cpaping.com", 546, 25, "#AFC3D6")

    img = img.resize((W, H), Image.Resampling.LANCZOS)
    for filename in ("og-share-v2.png", "og.png"):
        out = HERE / filename
        img.save(out, optimize=True)
        print(f"{out}: {W}×{H}, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
