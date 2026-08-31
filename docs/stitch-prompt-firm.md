# Stitch 프롬프트 — 법인 상세 페이지

`cpaping.com/firm/새빛회계법인` 화면 디자인을 뽑기 위한 프롬프트.
공고 목록에서 법인명을 누르면 오는 페이지다.

지난번 공고 목록 때 Stitch 가 지시를 여러 개 무시했다(Material Design 토큰
덤프, 아이콘 폰트, 사이드바, 다크모드, 데이터 환각). 그래서 **금지 사항을
맨 앞에 두고** 수치를 하나도 빠짐없이 적었다.

> 숫자는 새빛회계법인 사업보고서 5개년 실제 값이다. 환각을 막으려면
> 예시가 아니라 실제 데이터를 줘야 한다.

---

## 프롬프트 (전문 복사)

```
Design a company detail page for "CPAPING", a Korean job-alert service for
accounting firms. This page shows one accounting firm's profile with 5 years
of financial and headcount data. Light mode only. Mobile-first; also design
the desktop layout (max content width 720px, centered).

=== HARD CONSTRAINTS — read these first ===
DO NOT add a sidebar, top navigation menu, login, search box, hero image,
  breadcrumb bar, or footer links beyond what is specified.
DO NOT use Material Symbols, Font Awesome, or any icon font.
DO NOT add dark mode, dark: classes, or a theme toggle.
DO NOT invent any numbers. Use exactly the values given below.
DO NOT use a design token system other than the colors listed below.
Keep every Korean string exactly as written.

=== TONE ===
A dense, quiet reference page. Think of a well-set financial report, not a
marketing page. Numbers are the content; typography and spacing do the work.
Charts are small and precise, not decorative. No gradients, no shadows,
no rounded cards stacked on each other.

=== DESIGN TOKENS — use these exact values ===
  text primary      #101317
  text secondary    #5B6472
  text tertiary     #868D99
  border            #E4E6EA
  border light      #EDEFF2
  surface           #FFFFFF
  surface subtle    #FBFBFC
  accent            #123A8A     (links, primary chart series)
  positive          #17A05F     (growth)
  urgent            #B4341F     (deadline)
  chip default      bg #EEF1F6, text #4A5462
  chip highlight    bg #FBF0E4, text #8A5A19
  border radius     4px maximum
  font              IBM Plex Sans KR (fallback: Pretendard, system sans)
  tabular numerals  use font-variant-numeric: tabular-nums for all figures

Chart palette (4 series, must stay distinguishable in grayscale):
  감사   #123A8A
  세무   #4A79C4
  딜자문 #8FB0DE
  기타   #D3DFF0

=== PAGE STRUCTURE — top to bottom ===

1. TOP BAR (44px, background #FBFBFC, 1px bottom border)
   Left: "CPAPING" (13.5px, weight 600)
   Right: "← 공고 목록" (12px, #5B6472)

2. FIRM HEADER (padding 26px 18px 22px, 1px bottom border)
   Firm name "새빛회계법인" — 22px, weight 600, letter-spacing -0.02em
   Below it, one line of small chips (10.5px, radius 3px):
     "Forvis Mazars in Korea"  (highlight chip)
     "서울 용산구"              (default chip)
     "회계사 32명"              (default chip)
   Below the chips, one line at 12px #868D99:
     "서울특별시 용산구 원효로90길 11, 19층"
   On the right side of this block, a text link "홈페이지 ↗" (12px, #123A8A)

3. KEY FIGURES — a 4-column row of stat tiles (2 columns on mobile).
   No card borders between them; separate with thin vertical rules only.
   Each tile: label 11px #868D99 on top, value 20px weight 600 below,
   and a small note 11px underneath.

     매출액        138.96억   2025년 8월 기준
     5년 성장       +88%       2021년 대비        (value in #17A05F)
     회계사 수      32명       파트너 10명 포함
     1인당 매출     4.3억      매출 ÷ 회계사 수

4. CHART — 매출 추이 (section title 13px weight 600, then the chart)
   A vertical STACKED BAR chart, 5 bars, one per year.
   Y axis in 억원, gridlines every 50 (0 / 50 / 100 / 150), hairline #EDEFF2.
   X labels: 2021 2022 2023 2024 2025
   Legend above the chart, one line, small squares + labels:
     감사 · 세무 · 딜자문 · 기타
   Stack order bottom→top: 감사, 세무, 딜자문, 기타

   Exact values (억원):
     2021  감사 18.21  세무 41.04  딜자문 3.42   기타 11.06  합계 73.72
     2022  감사 20.27  세무 53.59  딜자문 3.95   기타 7.83   합계 85.64
     2023  감사 24.14  세무 63.88  딜자문 5.51   기타 11.76  합계 105.29
     2024  감사 28.40  세무 69.80  딜자문 8.10   기타 13.11  합계 119.40
     2025  감사 36.25  세무 78.34  딜자문 11.17  기타 13.21  합계 138.96

   Print the total above each bar in 11px #5B6472.

5. CHART — 부문 구성 (2025년 기준)
   A single horizontal 100% stacked bar, full width, 28px tall, radius 2px.
   Segments in the same colors and order. Label each segment inside if it
   fits, otherwise below:
     감사 26.1%  ·  세무 56.4%  ·  딜자문 8.0%  ·  기타 9.5%
   Under it, one sentence at 12px #5B6472:
     "세무 부문 비중이 가장 큽니다."

6. CHART — 인력 추이
   A grouped bar chart or line+bar combo, 5 years.
   Two series:
     회계사 수 (bar, #123A8A):   17  19  26  27  32
     파트너 수 (bar, #8FB0DE):    4   6   5  10  10
   Y axis 0–35, gridlines every 10.

7. 수습회계사 채용 이력 — THE MOST IMPORTANT SECTION
   Give this visual weight. It is what a job applicant actually wants.
   A row of 5 small bars or dots, one per year, with the number under each:
     2021: 3명   2022: 0명   2023: 0명   2024: 0명   2025: 4명
   Years with 0 are drawn as an empty outlined shape, not filled.
   Years with a value use the highlight chip color #8A5A19.
   Under the row, one sentence at 12.5px #101317:
     "2022~2024년에는 수습회계사를 뽑지 않았고, 2025년에 4명을 채용했습니다."

8. 이 법인의 공고 (section title, then a list)
   Rows in the same style as the main job list:
     line 1: 08.28 등록          (11.5px #5B6472)
     line 2: 2026년 신입 공인회계사 모집   (13.5px weight 500)
     line 3: chips "서울 용산구" "정규직"
     right side: "D-6" over "09.06", right-aligned, tabular numerals
   One row only. Below it: "공고 1건" at 12px #868D99.

9. 기본 정보 — a two-column definition table, 13px, hairline row borders
     대표이사        이정민
     본사 소재지      서울특별시 용산구 원효로90길 11, 19층
     상장회사 감사인   미등록
     소속 회계사      32명 (파트너 10명)
     자료 기준        2025년 8월 사업보고서

10. FOOTER NOTE (11.5px #868D99, top border, padding 20px 18px)
    "재무 정보는 회계법인 사업보고서 기준입니다. 잘못된 내용이 있으면
     contact@cpaping.com 으로 알려주세요."
    Below that: "CPAPING · 한국공인회계사회 공고를 수집합니다"

=== CHART IMPLEMENTATION ===
Draw all charts as inline SVG. Do not load Chart.js, D3, or any chart
library. Keep axis labels at 10.5px #868D99 and gridlines 1px #EDEFF2.
Every chart must scroll horizontally inside its own container on narrow
screens rather than shrinking the labels.
```

---

## 후속 프롬프트 — 자료가 없는 법인

15곳 중 대부분은 아직 재무 자료가 없다. 그때 화면이 초라해지면 안 된다.

```
Same design system and tokens. Show the same page for a firm with NO
financial data — only the name, region, and job postings are known.

Omit sections 3 through 7 entirely (key figures and all charts). Do not
show empty charts, zero values, or "자료 없음" placeholders — just leave
them out so the page reads as complete.

Keep: top bar, firm header (name + region chip only), 이 법인의 공고,
기본 정보 (only the rows that have values), footer note.

Firm: 동성회계법인 · 지역무관 · 공고 1건
  08.23 등록 / 수습 회계사 채용 / 지역무관 · 정규직 / D-30 · 09.30
기본 정보 rows: 자료 기준 — "채용 공고 기준"

Add one line under 기본 정보 at 12px #868D99:
  "재무 정보는 준비 중입니다."
```

---

## Stitch 결과를 받은 뒤

지난번처럼 그대로 쓰지 않는다. **레이아웃과 시각적 위계만** 가져오고
아래는 직접 정리한다.

- Material Design 토큰 덤프, 다크모드 클래스, 아이콘 폰트 제거
- `IBM Plex Sans` → **`IBM Plex Sans KR`** (한글이 폴백되면 밀도가 무너진다)
- 차트는 실제 데이터로 다시 그린다. Stitch 가 그린 SVG 는 눈금이 맞지 않는다
- 숫자는 빌드 시 DB 에서 주입한다. 하드코딩하면 자료를 갱신해도 화면이 안 바뀐다

## 참고 — 데이터 출처

`source/새빛회계법인/` 의 사업보고서 5개년 PDF 와
`새빛회계법인_5개년_정리.csv`. 수치는 전부 거기서 나왔다.
